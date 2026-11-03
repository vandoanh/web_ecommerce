import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, storeApi } from "./store";
import {
  CHECKOUT_ATTEMPT_STORAGE_KEY,
  CHECKOUT_COMPLETION_STORAGE_KEY,
  CHECKOUT_LOCK_NAME,
  CHECKOUT_WAITER_STORAGE_KEY,
  CheckoutLockUnavailableError,
  checkoutCartMatches,
  checkoutOwnerFromToken,
  clearCheckoutAttempt,
  createCheckoutAttempt,
  inspectCheckoutAttempt,
  isIdempotencyConflict,
  isUncertainCheckoutError,
  loadCheckoutAttempt,
  planCheckoutSubmission,
  runCheckoutSubmission,
  saveCheckoutAttempt,
  withCheckoutLock,
  type CheckoutAttempt,
  type CheckoutLockManager,
  type CheckoutStorage,
  type CheckoutSubmissionOutcome,
} from "./checkout";
import type { CreateOrderPayload } from "./store";

const payload: CreateOrderPayload = {
  recipientName: "Nguyễn An",
  phone: "0901234567",
  shippingAddress: "12 Lê Lợi, Quận 1",
  items: [
    { productId: 3, quantity: 2 },
    { productId: 1, quantity: 1 },
  ],
};

function createMemoryStorage(
  options: { failWrite?: boolean; failKey?: string } = {},
): CheckoutStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (options.failWrite || options.failKey === key) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

class SerialLockManager implements CheckoutLockManager {
  private tail: Promise<unknown> = Promise.resolve();
  private active = 0;
  maxActive = 0;

  get activeCount() {
    return this.active;
  }

  request<T>(
    _name: string,
    _options: { mode: "exclusive" },
    callback: () => Promise<T> | T,
  ): Promise<T> {
    const run = this.tail.then(async () => {
      this.active += 1;
      this.maxActive = Math.max(this.maxActive, this.active);
      try {
        return await callback();
      } finally {
        this.active -= 1;
      }
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/**
 * Exclusive lock whose queue is held until the test explicitly releases it.
 * That makes the cross-tab interleaving deterministic: both tabs can enqueue
 * their waiter registration before either submission starts.
 */
class ManualLockManager implements CheckoutLockManager {
  private queue: Array<() => void> = [];
  private queueWaiters: Array<{ count: number; resolve: () => void }> = [];
  private active = 0;
  private released = false;
  maxActive = 0;

  get activeCount() {
    return this.active;
  }

  request<T>(
    _name: string,
    _options: { mode: "exclusive" },
    callback: () => Promise<T> | T,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        this.active += 1;
        this.maxActive = Math.max(this.maxActive, this.active);
        Promise.resolve()
          .then(callback)
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            this.pump();
          });
      });
      this.notifyQueueWaiters();
      this.pump();
    });
  }

  async waitForQueued(count: number): Promise<void> {
    if (this.queue.length >= count) return;
    await new Promise<void>((resolve) => {
      this.queueWaiters.push({ count, resolve });
    });
  }

  release() {
    this.released = true;
    this.pump();
  }

  private notifyQueueWaiters() {
    const ready = this.queueWaiters.filter((waiter) => this.queue.length >= waiter.count);
    this.queueWaiters = this.queueWaiters.filter((waiter) => this.queue.length < waiter.count);
    ready.forEach((waiter) => waiter.resolve());
  }

  private pump() {
    if (!this.released || this.active > 0) return;
    const task = this.queue.shift();
    if (!task) return;
    task();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("checkout attempt retention", () => {
  it("retains the exact payload and idempotency key after an uncertain result and replays them", async () => {
    const attempt = createCheckoutAttempt(payload, {
      idempotencyKey: "6fa459ea-ee8a-4d3a-8f4a-6b8a1e4f9f11",
      owner: "42",
      now: "2026-11-02T00:00:00.000Z",
    });
    saveCheckoutAttempt(attempt);

    const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);

    const failure = await storeApi
      .createOrder("customer-jwt", attempt.payload, attempt.idempotencyKey)
      .catch((reason: unknown) => reason);
    expect(isUncertainCheckoutError(failure)).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/orders",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "6fa459ea-ee8a-4d3a-8f4a-6b8a1e4f9f11",
        }),
        body: JSON.stringify(payload),
      }),
    );

    const retained = loadCheckoutAttempt("42");
    expect(retained).toEqual(attempt);

    const retry = planCheckoutSubmission(retained, retained?.payload ?? payload, {
      owner: "42",
      idempotencyKey: "4d4d40f5-01b6-48af-8d15-a6f77cacbd67",
    });
    expect(retry).toEqual({ action: "retry", attempt });
    if (retry.action !== "retry") throw new Error("expected a retry plan");
    expect(retry.attempt.idempotencyKey).toBe(attempt.idempotencyKey);
    expect(JSON.stringify(retry.attempt.payload)).toBe(JSON.stringify(attempt.payload));
    expect(window.localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)).toContain(
      attempt.idempotencyKey,
    );
  });

  it("blocks a changed cart until the uncertain attempt is explicitly abandoned, then restarts fresh", () => {
    const attempt = createCheckoutAttempt(payload, {
      idempotencyKey: "6fa459ea-ee8a-4d3a-8f4a-6b8a1e4f9f11",
      owner: "42",
    });
    saveCheckoutAttempt(attempt);
    const changed: CreateOrderPayload = {
      ...payload,
      items: [{ productId: 1, quantity: 5 }],
    };

    const blocked = planCheckoutSubmission(attempt, changed, {
      owner: "42",
      idempotencyKey: "4d4d40f5-01b6-48af-8d15-a6f77cacbd67",
    });
    expect(blocked).toEqual({ action: "blocked", attempt, reason: "payload-changed" });
    expect(loadCheckoutAttempt("42")?.idempotencyKey).toBe(attempt.idempotencyKey);

    // Explicit abandon/restart is required before a new attempt receives a new key.
    clearCheckoutAttempt();
    const restarted = planCheckoutSubmission(loadCheckoutAttempt("42"), changed, {
      owner: "42",
      idempotencyKey: "4d4d40f5-01b6-48af-8d15-a6f77cacbd67",
    });
    expect(restarted).toEqual({
      action: "create",
      attempt: expect.objectContaining({
        idempotencyKey: "4d4d40f5-01b6-48af-8d15-a6f77cacbd67",
        payload: changed,
        owner: "42",
      }),
    });
  });

  it("reuses the original exact payload even when only the current item order differs", () => {
    const attempt = createCheckoutAttempt(payload, {
      idempotencyKey: "6fa459ea-ee8a-4d3a-8f4a-6b8a1e4f9f11",
    });
    const reordered: CreateOrderPayload = {
      ...payload,
      items: [...payload.items].reverse(),
    };

    expect(checkoutCartMatches(attempt, reordered.items)).toBe(true);
    expect(planCheckoutSubmission(attempt, reordered)).toEqual({
      action: "retry",
      attempt,
    });
  });
});

describe("checkout uncertainty and ownership", () => {
  it("only treats missing, timeout, and server responses as uncertain", () => {
    expect(isUncertainCheckoutError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isUncertainCheckoutError(new ApiError("Request timeout (408)", 408))).toBe(true);
    expect(isUncertainCheckoutError(new ApiError("Could not create order (500)", 500))).toBe(true);
    expect(isUncertainCheckoutError(new ApiError("Conflict (409)", 409))).toBe(false);
    expect(isUncertainCheckoutError(new ApiError("Bad request (400)", 400))).toBe(false);
    expect(
      isIdempotencyConflict(
        new ApiError("idempotency key was already used with a different request (409)", 409),
      ),
    ).toBe(true);
    expect(
      isIdempotencyConflict(new ApiError("one or more products are unavailable (409)", 409)),
    ).toBe(false);
  });

  it("reports a mismatched owner without exposing the other account's attempt", () => {
    const attempt = createCheckoutAttempt(payload, {
      idempotencyKey: "6fa459ea-ee8a-4d3a-8f4a-6b8a1e4f9f11",
      owner: "42",
    });
    saveCheckoutAttempt(attempt);

    expect(inspectCheckoutAttempt("42")).toEqual({ status: "owned", attempt });
    expect(inspectCheckoutAttempt("7")).toEqual({ status: "owner-mismatch" });
    expect(inspectCheckoutAttempt(null)).toEqual({ status: "owner-mismatch" });
    expect("attempt" in inspectCheckoutAttempt("7")).toBe(false);
    expect(loadCheckoutAttempt("7")).toEqual(attempt);
    expect(planCheckoutSubmission(attempt, payload, { owner: "7" })).toEqual({
      action: "blocked",
      reason: "owner-mismatch",
    });
    expect(JSON.parse(window.localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) ?? "null")).toEqual(
      attempt,
    );
  });

  it("does not create or post while another owner's attempt exists", async () => {
    const storage = createMemoryStorage();
    const attempt = createCheckoutAttempt(payload, {
      idempotencyKey: "6fa459ea-ee8a-4d3a-8f4a-6b8a1e4f9f11",
      owner: "42",
    });
    storage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
    const submit = vi.fn(async () => ({ orderNumber: "ORD-1" }));

    const result = await runCheckoutSubmission({
      owner: "7",
      payload,
      storage,
      lockManager: new SerialLockManager(),
      submit,
    });

    expect(result).toEqual({ status: "blocked", reason: "owner-mismatch" });
    expect(submit).not.toHaveBeenCalled();
    expect(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)).toBe(JSON.stringify(attempt));
  });

  it("reads the customer id from the JWT payload for attempt scoping", () => {
    const encode = (value: unknown) =>
      btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const token = `${encode({ alg: "HS256" })}.${encode({ id: 42, username: "an" })}.signature`;

    expect(checkoutOwnerFromToken(token)).toBe("42");
    expect(checkoutOwnerFromToken("not-a-token")).toBeNull();
  });
});

describe("checkout storage and cross-tab guarantees", () => {
  it("fails closed instead of inventing a lock when Web Locks are unavailable", async () => {
    const storage = createMemoryStorage();
    const submit = vi.fn(async () => ({ orderNumber: "ORD-1" }));

    const result = await runCheckoutSubmission({
      owner: "42",
      payload,
      storage,
      lockManager: null,
      submit,
    });

    expect(result).toMatchObject({ status: "blocked", reason: "lock-unavailable" });
    expect(result).toHaveProperty("error");
    expect((result as { error: unknown }).error).toBeInstanceOf(CheckoutLockUnavailableError);
    expect(submit).not.toHaveBeenCalled();
    expect(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)).toBeNull();
  });

  it("uses a named exclusive Web Lock", async () => {
    const callback = vi.fn(() => "ok");
    const request = vi.fn(
      (_name: string, _options: { mode: "exclusive" }, operation: () => unknown) =>
        Promise.resolve(operation()),
    );
    const lockManager = { request } as unknown as CheckoutLockManager;

    await expect(withCheckoutLock(callback, { lockManager })).resolves.toBe("ok");
    expect(request).toHaveBeenCalledWith(CHECKOUT_LOCK_NAME, { mode: "exclusive" }, callback);
  });

  it("never posts when the attempt cannot be persisted", async () => {
    const storage = createMemoryStorage({ failWrite: true });
    const submit = vi.fn(async () => ({ orderNumber: "ORD-1" }));

    const result = await runCheckoutSubmission({
      owner: "42",
      payload,
      storage,
      lockManager: new SerialLockManager(),
      idempotencyKey: "key-1",
      submit,
    });

    expect(result).toMatchObject({ status: "blocked", reason: "storage-write-failed" });
    expect(submit).not.toHaveBeenCalled();
    expect(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)).toBeNull();
  });

  it("does not retain an attempt or write a completion marker when no tab was waiting", async () => {
    const storage = createMemoryStorage();
    const locks = new SerialLockManager();
    const keys: string[] = [];
    const submit = vi.fn(async (attempt: CheckoutAttempt) => {
      keys.push(attempt.idempotencyKey);
      return { orderNumber: `ORD-${keys.length}` };
    });

    const first = await runCheckoutSubmission({
      owner: "42",
      payload,
      storage,
      lockManager: locks,
      idempotencyKey: "key-1",
      submit,
    });
    const second = await runCheckoutSubmission({
      owner: "42",
      payload,
      storage,
      lockManager: locks,
      idempotencyKey: "key-2",
      submit,
    });

    expect(first).toMatchObject({ status: "created", orderNumber: "ORD-1" });
    expect(second).toMatchObject({ status: "created", orderNumber: "ORD-2" });
    if (first.status !== "created") throw new Error("expected a created order");
    expect(first.storageWarning).toBeUndefined();
    expect(keys).toEqual(["key-1", "key-2"]);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(CHECKOUT_COMPLETION_STORAGE_KEY)).toBeNull();
  });

  it("keeps the attempt for an already-waiting tab when the completion marker fails and replays the same key", async () => {
    const storage = createMemoryStorage({ failKey: CHECKOUT_COMPLETION_STORAGE_KEY });
    const locks = new SerialLockManager();
    const keys: string[] = [];
    const submit = vi.fn(async (attempt: CheckoutAttempt) => {
      keys.push(attempt.idempotencyKey);
      return { orderNumber: "ORD-1" };
    });

    const [first, second] = await Promise.all([
      runCheckoutSubmission({
        owner: "42",
        payload,
        storage,
        lockManager: locks,
        idempotencyKey: "key-1",
        submit,
      }),
      runCheckoutSubmission({
        owner: "42",
        payload,
        storage,
        lockManager: locks,
        idempotencyKey: "key-2",
        submit,
      }),
    ]);

    expect(first).toMatchObject({ status: "created", orderNumber: "ORD-1" });
    expect(second).toMatchObject({ status: "created", orderNumber: "ORD-1" });
    expect(keys).toEqual(["key-1", "key-1"]);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)).toBeNull();
  });

  it("reports a storage read failure instead of treating it as no attempt", () => {
    const storage: CheckoutStorage = {
      getItem: () => {
        throw new DOMException("Denied", "SecurityError");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };

    expect(inspectCheckoutAttempt("42", storage)).toMatchObject({ status: "unavailable" });
  });

  it("does not silently discard a corrupt attempt record", () => {
    window.localStorage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, "{not-json");

    expect(inspectCheckoutAttempt("42")).toEqual({ status: "invalid" });
    expect(window.localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)).toBe("{not-json");
  });

  it("allows an immediate same-payload purchase after success to create a new order", async () => {
    const storage = createMemoryStorage();
    const locks = new SerialLockManager();
    const keys: string[] = [];
    const submit = vi.fn(async (attempt: CheckoutAttempt) => {
      keys.push(attempt.idempotencyKey);
      return { orderNumber: `ORD-${keys.length}` };
    });

    const first = await runCheckoutSubmission({
      owner: "42",
      payload,
      storage,
      lockManager: locks,
      idempotencyKey: "key-1",
      submit,
    });
    const second = await runCheckoutSubmission({
      owner: "42",
      payload,
      storage,
      lockManager: locks,
      idempotencyKey: "key-2",
      submit,
    });

    expect(first).toMatchObject({
      status: "created",
      orderNumber: "ORD-1",
      reusedCompletion: false,
    });
    expect(second).toMatchObject({
      status: "created",
      orderNumber: "ORD-2",
      reusedCompletion: false,
    });
    expect(keys).toEqual(["key-1", "key-2"]);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)).toBeNull();
  });

  it("ignores a recent completion marker that does not claim this submission", async () => {
    const storage = createMemoryStorage();
    const oldAttempt = createCheckoutAttempt(payload, {
      idempotencyKey: "old-key",
      owner: "42",
      now: new Date().toISOString(),
    });
    storage.setItem(
      CHECKOUT_COMPLETION_STORAGE_KEY,
      JSON.stringify({
        attempt: oldAttempt,
        orderNumber: "ORD-OLD",
        completedAt: new Date().toISOString(),
        waiterIds: ["waiter-from-an-older-tab"],
      }),
    );
    const keys: string[] = [];
    const submit = vi.fn(async (attempt: CheckoutAttempt) => {
      keys.push(attempt.idempotencyKey);
      return { orderNumber: "ORD-NEW" };
    });

    const result = await runCheckoutSubmission({
      owner: "42",
      payload,
      storage,
      lockManager: new SerialLockManager(),
      idempotencyKey: "new-key",
      submit,
    });

    expect(result).toMatchObject({
      status: "created",
      orderNumber: "ORD-NEW",
      reusedCompletion: false,
    });
    expect(keys).toEqual(["new-key"]);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)).toBeNull();
  });

  it("serializes concurrent creates and reuses the confirmed order across tabs", async () => {
    const storage = createMemoryStorage();
    const locks = new SerialLockManager();
    const keys: string[] = [];
    const submit = vi.fn(async (attempt: CheckoutAttempt) => {
      keys.push(attempt.idempotencyKey);
      return { orderNumber: "ORD-1" };
    });

    const [first, second] = await Promise.all([
      runCheckoutSubmission({
        owner: "42",
        payload,
        storage,
        lockManager: locks,
        idempotencyKey: "key-1",
        submit,
      }),
      runCheckoutSubmission({
        owner: "42",
        payload,
        storage,
        lockManager: locks,
        idempotencyKey: "key-2",
        submit,
      }),
    ]);

    expect(locks.maxActive).toBe(1);
    expect(first).toMatchObject({ status: "created", orderNumber: "ORD-1" });
    expect(second).toMatchObject({
      status: "created",
      orderNumber: "ORD-1",
      reusedCompletion: true,
    });
    expect(keys).toEqual(["key-1"]);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(CHECKOUT_COMPLETION_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(CHECKOUT_WAITER_STORAGE_KEY)).toBeNull();
  });

  it("registers every tab that starts together before the first submission, then reuses and later starts fresh", async () => {
    const storage = createMemoryStorage();
    const locks = new ManualLockManager();
    const keys: string[] = [];
    const waitersSeenBySubmit: string[][] = [];
    const submit = vi.fn(async (attempt: CheckoutAttempt) => {
      keys.push(attempt.idempotencyKey);
      const stored = storage.getItem(CHECKOUT_WAITER_STORAGE_KEY);
      waitersSeenBySubmit.push(
        stored ? (JSON.parse(stored) as Array<{ id: string }>).map((waiter) => waiter.id) : [],
      );
      return { orderNumber: `ORD-${keys.length}` };
    });

    const firstRun = runCheckoutSubmission({
      owner: "42",
      payload,
      storage,
      lockManager: locks,
      idempotencyKey: "key-1",
      submit,
    });
    const secondRun = runCheckoutSubmission({
      owner: "42",
      payload,
      storage,
      lockManager: locks,
      idempotencyKey: "key-2",
      submit,
    });

    await locks.waitForQueued(2);
    expect(locks.maxActive).toBe(0);
    locks.release();

    const [first, second] = await Promise.all([firstRun, secondRun]);

    expect(locks.maxActive).toBe(1);
    expect(waitersSeenBySubmit).toHaveLength(1);
    expect(waitersSeenBySubmit[0]).toHaveLength(2);
    expect(first).toMatchObject({
      status: "created",
      orderNumber: "ORD-1",
      reusedCompletion: false,
    });
    expect(second).toMatchObject({
      status: "created",
      orderNumber: "ORD-1",
      reusedCompletion: true,
    });
    expect(keys).toEqual(["key-1"]);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(CHECKOUT_COMPLETION_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(CHECKOUT_WAITER_STORAGE_KEY)).toBeNull();

    const later = await runCheckoutSubmission({
      owner: "42",
      payload,
      storage,
      lockManager: locks,
      idempotencyKey: "key-3",
      submit,
    });

    expect(later).toMatchObject({
      status: "created",
      orderNumber: "ORD-2",
      reusedCompletion: false,
    });
    expect(keys).toEqual(["key-1", "key-3"]);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(storage.getItem(CHECKOUT_WAITER_STORAGE_KEY)).toBeNull();
  });

  it("mutates waiter bookkeeping only while holding the checkout lock", async () => {
    const base = createMemoryStorage();
    const locks = new SerialLockManager();
    const violations: string[] = [];
    const track = (operation: string) => {
      if (locks.activeCount !== 1)
        violations.push(`${operation} outside lock (${locks.activeCount})`);
    };
    const storage: CheckoutStorage = {
      getItem: (key) => {
        if (key === CHECKOUT_WAITER_STORAGE_KEY) track("read");
        return base.getItem(key);
      },
      setItem: (key, value) => {
        if (key === CHECKOUT_WAITER_STORAGE_KEY) track("write");
        base.setItem(key, value);
      },
      removeItem: (key) => {
        if (key === CHECKOUT_WAITER_STORAGE_KEY) track("remove");
        base.removeItem(key);
      },
    };
    const submit = vi.fn(async () => ({ orderNumber: "ORD-1" }));

    await Promise.all([
      runCheckoutSubmission({
        owner: "42",
        payload,
        storage,
        lockManager: locks,
        idempotencyKey: "key-1",
        submit,
      }),
      runCheckoutSubmission({
        owner: "42",
        payload,
        storage,
        lockManager: locks,
        idempotencyKey: "key-2",
        submit,
      }),
    ]);

    expect(violations).toEqual([]);
    expect(storage.getItem(CHECKOUT_WAITER_STORAGE_KEY)).toBeNull();
  });

  it("does not lose a waiter that registers during another tab's read-modify-write", async () => {
    const storage = createMemoryStorage();
    const locks = new SerialLockManager();
    const keys: string[] = [];
    const submit = vi.fn(async (attempt: CheckoutAttempt) => {
      keys.push(attempt.idempotencyKey);
      return { orderNumber: "ORD-1" };
    });
    const readItem = storage.getItem;
    let secondRun: Promise<CheckoutSubmissionOutcome> | undefined;
    let startedSecondRun = false;
    storage.getItem = (key) => {
      const value = readItem(key);
      if (key === CHECKOUT_WAITER_STORAGE_KEY && !startedSecondRun) {
        startedSecondRun = true;
        secondRun = runCheckoutSubmission({
          owner: "42",
          payload,
          storage,
          lockManager: locks,
          idempotencyKey: "key-2",
          submit,
        });
      }
      return value;
    };

    const first = await runCheckoutSubmission({
      owner: "42",
      payload,
      storage,
      lockManager: locks,
      idempotencyKey: "key-1",
      submit,
    });
    if (!secondRun) throw new Error("expected the second tab to start");
    const second = await secondRun;

    expect(first).toMatchObject({
      status: "created",
      orderNumber: "ORD-1",
      reusedCompletion: false,
    });
    expect(second).toMatchObject({
      status: "created",
      orderNumber: "ORD-1",
      reusedCompletion: true,
    });
    expect(keys).toEqual(["key-1"]);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHECKOUT_WAITER_STORAGE_KEY)).toBeNull();
  });

  it("keeps the exact key and payload for an uncertain first tab and lets the waiting tab replay it", async () => {
    const storage = createMemoryStorage();
    const locks = new ManualLockManager();
    const calls: Array<{ key: string; body: string }> = [];
    const submit = vi.fn(async (attempt: CheckoutAttempt) => {
      calls.push({
        key: attempt.idempotencyKey,
        body: JSON.stringify(attempt.payload),
      });
      if (calls.length === 1) throw new TypeError("Failed to fetch");
      return { orderNumber: "ORD-1" };
    });

    const firstRun = runCheckoutSubmission({
      owner: "42",
      payload,
      storage,
      lockManager: locks,
      idempotencyKey: "key-1",
      submit,
    });
    const secondRun = runCheckoutSubmission({
      owner: "42",
      payload,
      storage,
      lockManager: locks,
      idempotencyKey: "key-2",
      submit,
    });

    await locks.waitForQueued(2);
    locks.release();

    const [first, second] = await Promise.all([firstRun, secondRun]);

    expect(first).toMatchObject({ status: "retained", reason: "uncertain" });
    expect(first).toHaveProperty("attempt.idempotencyKey", "key-1");
    expect(first).toHaveProperty("attempt.payload", payload);
    expect(second).toMatchObject({ status: "created", orderNumber: "ORD-1" });
    expect(calls).toHaveLength(2);
    expect(calls[0].key).toBe("key-1");
    expect(calls[1].key).toBe("key-1");
    expect(calls[1].body).toBe(calls[0].body);
    expect(JSON.parse(calls[0].body)).toEqual(payload);
    expect(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(CHECKOUT_COMPLETION_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(CHECKOUT_WAITER_STORAGE_KEY)).toBeNull();
  });

  it("does not leave a waiter behind when a run is blocked or definitively fails", async () => {
    const storage = createMemoryStorage();
    const locks = new SerialLockManager();
    const ownerAttempt = createCheckoutAttempt(payload, {
      idempotencyKey: "owner-key",
      owner: "42",
    });
    storage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, JSON.stringify(ownerAttempt));

    const acceptedKeys: string[] = [];
    const submit = vi.fn(async (attempt: CheckoutAttempt) => {
      acceptedKeys.push(attempt.idempotencyKey);
      return { orderNumber: "ORD-NEW" };
    });
    const blocked = await runCheckoutSubmission({
      owner: "7",
      payload,
      storage,
      lockManager: locks,
      idempotencyKey: "key-1",
      submit,
    });

    expect(blocked).toMatchObject({ status: "blocked", reason: "owner-mismatch" });
    expect(submit).not.toHaveBeenCalled();
    expect(storage.getItem(CHECKOUT_WAITER_STORAGE_KEY)).toBeNull();

    storage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    const failed = await runCheckoutSubmission({
      owner: "42",
      payload,
      storage,
      lockManager: locks,
      idempotencyKey: "key-2",
      submit: vi.fn().mockRejectedValue(new ApiError("Bad request (400)", 400)),
    });

    expect(failed).toMatchObject({ status: "failed" });
    expect(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(CHECKOUT_COMPLETION_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(CHECKOUT_WAITER_STORAGE_KEY)).toBeNull();

    const later = await runCheckoutSubmission({
      owner: "42",
      payload,
      storage,
      lockManager: locks,
      idempotencyKey: "key-3",
      submit,
    });

    expect(later).toMatchObject({
      status: "created",
      orderNumber: "ORD-NEW",
      reusedCompletion: false,
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(acceptedKeys).toEqual(["key-3"]);
    expect(storage.getItem(CHECKOUT_WAITER_STORAGE_KEY)).toBeNull();
  });
});
