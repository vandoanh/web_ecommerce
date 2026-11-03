import { ApiError, type CreateOrderPayload } from "@/lib/store";
import { newIdempotencyKey } from "@/lib/idempotency";

export const CHECKOUT_ATTEMPT_STORAGE_KEY = "store-checkout-attempt";
export const CHECKOUT_COMPLETION_STORAGE_KEY = "store-checkout-completion";
export const CHECKOUT_WAITER_STORAGE_KEY = "store-checkout-waiters";
export const CHECKOUT_LOCK_NAME = "store-checkout-attempt";

/**
 * A completion may only be reused by a submission that was already waiting
 * when the order was confirmed. Waiting submissions are recorded per run so a
 * later, deliberate same-payload purchase is never mistaken for that race.
 * The TTL only prunes abandoned waiters; it does not make completions reusable.
 */
export const CHECKOUT_WAITER_TTL_MS = 15 * 60_000;

export type CheckoutAttempt = {
  idempotencyKey: string;
  payload: CreateOrderPayload;
  owner: string | null;
  createdAt: string;
};

export type CheckoutAttemptState =
  | { status: "none" }
  | { status: "owned"; attempt: CheckoutAttempt }
  | { status: "owner-mismatch" }
  | { status: "invalid" }
  | { status: "unavailable"; error: unknown };

export type CheckoutSubmissionPlan =
  | { action: "create"; attempt: CheckoutAttempt }
  | { action: "retry"; attempt: CheckoutAttempt }
  | { action: "blocked"; attempt: CheckoutAttempt; reason: "payload-changed" }
  | { action: "blocked"; reason: "owner-mismatch" };

export type CheckoutStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type CheckoutStorageErrorCode =
  "unavailable" | "quota-exceeded" | "write-failed" | "verification-failed";

export class CheckoutAttemptStorageError extends Error {
  readonly code: CheckoutStorageErrorCode;

  constructor(code: CheckoutStorageErrorCode, message: string) {
    super(message);
    this.name = "CheckoutAttemptStorageError";
    this.code = code;
  }
}

export type CheckoutLockManager = {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T> | T,
  ): Promise<T>;
};

export class CheckoutLockUnavailableError extends Error {
  constructor(message = "Cross-tab checkout locking is unavailable") {
    super(message);
    this.name = "CheckoutLockUnavailableError";
  }
}

export type CheckoutBlockedReason =
  | "owner-mismatch"
  | "payload-changed"
  | "attempt-missing"
  | "invalid-attempt"
  | "storage-unavailable"
  | "storage-write-failed"
  | "lock-unavailable";

export type CheckoutSubmissionOutcome =
  | {
      status: "created";
      attempt: CheckoutAttempt;
      orderNumber: string;
      reusedCompletion: boolean;
      storageWarning?: string;
    }
  | {
      status: "retained";
      attempt: CheckoutAttempt;
      reason: "uncertain" | "idempotency-conflict";
      error: unknown;
    }
  | { status: "failed"; error: unknown; storageWarning?: string }
  | { status: "blocked"; reason: CheckoutBlockedReason; error?: unknown };

export type RunCheckoutSubmissionOptions = {
  owner: string | null;
  payload: CreateOrderPayload;
  submit: (attempt: CheckoutAttempt) => Promise<{ orderNumber: string }>;
  storage?: CheckoutStorage;
  lockManager?: CheckoutLockManager | null;
  mode?: "checkout" | "retry";
  idempotencyKey?: string;
  now?: () => number;
};

type NewAttemptOptions = {
  idempotencyKey?: string;
  owner?: string | null;
  now?: string;
};

type CompletionRecord = {
  attempt: CheckoutAttempt;
  orderNumber: string;
  completedAt: string;
  waiterIds: string[];
};

type CheckoutWaiter = {
  id: string;
  owner: string | null;
  fingerprint: string;
  createdAt: number;
};

type WaitersRead =
  { status: "ok"; waiters: CheckoutWaiter[] } | { status: "unavailable"; error: unknown };

type StoredAttemptRead =
  | { status: "none" }
  | { status: "present"; attempt: CheckoutAttempt }
  | { status: "invalid" }
  | { status: "unavailable"; error: unknown };

type CompletionLookup =
  | { status: "none" }
  | { status: "present"; completion: CompletionRecord }
  | { status: "unavailable"; error: unknown };

export function newCheckoutIdempotencyKey(): string {
  return newIdempotencyKey();
}

function storageOrDefault(storage?: CheckoutStorage | null): CheckoutStorage {
  if (storage) return storage;
  if (typeof window === "undefined") {
    throw new CheckoutAttemptStorageError("unavailable", "Browser storage is unavailable");
  }
  try {
    return window.localStorage;
  } catch {
    throw new CheckoutAttemptStorageError("unavailable", "Browser storage is unavailable");
  }
}

function storageWriteErrorCode(error: unknown): CheckoutStorageErrorCode {
  if (error && typeof error === "object") {
    const candidate = error as { name?: unknown; code?: unknown };
    if (
      candidate.name === "QuotaExceededError" ||
      candidate.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      candidate.code === 22 ||
      candidate.code === 1014
    ) {
      return "quota-exceeded";
    }
  }
  return "write-failed";
}

function isCreateOrderPayload(value: unknown): value is CreateOrderPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<CreateOrderPayload>;
  return (
    typeof payload.recipientName === "string" &&
    typeof payload.phone === "string" &&
    typeof payload.shippingAddress === "string" &&
    Array.isArray(payload.items) &&
    payload.items.every(
      (item) =>
        Boolean(item) &&
        typeof item.productId === "number" &&
        Number.isInteger(item.productId) &&
        item.productId > 0 &&
        typeof item.quantity === "number" &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0,
    )
  );
}

function isCheckoutAttempt(value: unknown): value is CheckoutAttempt {
  if (!value || typeof value !== "object") return false;
  const attempt = value as Partial<CheckoutAttempt>;
  return (
    typeof attempt.idempotencyKey === "string" &&
    attempt.idempotencyKey.length > 0 &&
    isCreateOrderPayload(attempt.payload) &&
    (attempt.owner === null || typeof attempt.owner === "string") &&
    typeof attempt.createdAt === "string"
  );
}

function isCompletionRecord(value: unknown): value is CompletionRecord {
  if (!value || typeof value !== "object") return false;
  const completion = value as Partial<CompletionRecord>;
  return (
    isCheckoutAttempt(completion.attempt) &&
    typeof completion.orderNumber === "string" &&
    completion.orderNumber.length > 0 &&
    typeof completion.completedAt === "string" &&
    Array.isArray(completion.waiterIds) &&
    completion.waiterIds.every((id) => typeof id === "string" && id.length > 0)
  );
}

function isCheckoutWaiter(value: unknown): value is CheckoutWaiter {
  if (!value || typeof value !== "object") return false;
  const waiter = value as Partial<CheckoutWaiter>;
  return (
    typeof waiter.id === "string" &&
    waiter.id.length > 0 &&
    (waiter.owner === null || typeof waiter.owner === "string") &&
    typeof waiter.fingerprint === "string" &&
    typeof waiter.createdAt === "number" &&
    Number.isFinite(waiter.createdAt)
  );
}

function readCheckoutWaiters(storage: CheckoutStorage | undefined, now: number): WaitersRead {
  let target: CheckoutStorage;
  try {
    target = storageOrDefault(storage);
  } catch (error) {
    return { status: "unavailable", error };
  }

  let stored: string | null;
  try {
    stored = target.getItem(CHECKOUT_WAITER_STORAGE_KEY);
  } catch (error) {
    return { status: "unavailable", error };
  }
  if (stored === null) return { status: "ok", waiters: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    // Corrupt waiter bookkeeping must never block a checkout.
    return { status: "ok", waiters: [] };
  }
  if (!Array.isArray(parsed)) return { status: "ok", waiters: [] };

  const waiters = parsed
    .filter(isCheckoutWaiter)
    .filter(
      (waiter) => waiter.createdAt <= now && now - waiter.createdAt <= CHECKOUT_WAITER_TTL_MS,
    );
  return { status: "ok", waiters };
}

function writeCheckoutWaiters(waiters: CheckoutWaiter[], storage: CheckoutStorage | undefined) {
  const target = storageOrDefault(storage);
  if (waiters.length === 0) {
    target.removeItem(CHECKOUT_WAITER_STORAGE_KEY);
    return;
  }
  target.setItem(CHECKOUT_WAITER_STORAGE_KEY, JSON.stringify(waiters));
}

function registerCheckoutWaiter(
  waiter: CheckoutWaiter,
  storage: CheckoutStorage | undefined,
): void {
  const read = readCheckoutWaiters(storage, waiter.createdAt);
  if (read.status === "unavailable") return;
  const waiters = read.waiters.filter((candidate) => candidate.id !== waiter.id);
  waiters.push(waiter);
  try {
    writeCheckoutWaiters(waiters, storage);
  } catch {
    // Losing waiter bookkeeping only weakens cross-tab deduplication.
  }
}

function unregisterCheckoutWaiter(id: string, storage: CheckoutStorage | undefined): void {
  const read = readCheckoutWaiters(storage, Date.now());
  if (read.status === "unavailable") return;
  try {
    writeCheckoutWaiters(
      read.waiters.filter((waiter) => waiter.id !== id),
      storage,
    );
  } catch {
    // The stale waiter expires and cannot make a later completion reusable.
  }
}

function otherWaiterIds(
  owner: string | null,
  fingerprint: string,
  selfId: string,
  storage: CheckoutStorage | undefined,
  now: number,
): string[] {
  const read = readCheckoutWaiters(storage, now);
  if (read.status === "unavailable") return [];
  return read.waiters
    .filter(
      (waiter) =>
        waiter.id !== selfId && waiter.owner === owner && waiter.fingerprint === fingerprint,
    )
    .map((waiter) => waiter.id);
}

function readStoredAttempt(storage?: CheckoutStorage | null): StoredAttemptRead {
  let target: CheckoutStorage;
  try {
    target = storageOrDefault(storage);
  } catch (error) {
    return { status: "unavailable", error };
  }

  let stored: string | null;
  try {
    stored = target.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  } catch (error) {
    return { status: "unavailable", error };
  }

  if (stored === null) return { status: "none" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return { status: "invalid" };
  }
  if (!isCheckoutAttempt(parsed)) return { status: "invalid" };
  return { status: "present", attempt: parsed };
}

export function checkoutPayloadFingerprint(payload: CreateOrderPayload): string {
  const items = [...payload.items]
    .map((item) => ({ productId: item.productId, quantity: item.quantity }))
    .sort((left, right) => left.productId - right.productId);
  return JSON.stringify({
    recipientName: payload.recipientName,
    phone: payload.phone,
    shippingAddress: payload.shippingAddress,
    items,
  });
}

export function checkoutCartMatches(
  attempt: CheckoutAttempt,
  items: CreateOrderPayload["items"],
): boolean {
  const current = checkoutPayloadFingerprint({
    recipientName: attempt.payload.recipientName,
    phone: attempt.payload.phone,
    shippingAddress: attempt.payload.shippingAddress,
    items,
  });
  return current === checkoutPayloadFingerprint(attempt.payload);
}

export function createCheckoutAttempt(
  payload: CreateOrderPayload,
  options: NewAttemptOptions = {},
): CheckoutAttempt {
  return {
    idempotencyKey: options.idempotencyKey ?? newCheckoutIdempotencyKey(),
    payload,
    owner: options.owner ?? null,
    createdAt: options.now ?? new Date().toISOString(),
  };
}

/**
 * Chooses how a checkout submission must proceed. An existing uncertain attempt
 * is never replaced by a new key: it is replayed only when the payload is
 * identical and it belongs to the current owner, otherwise the caller must
 * explicitly abandon the old attempt first.
 */
export function planCheckoutSubmission(
  pending: CheckoutAttempt | null,
  payload: CreateOrderPayload,
  options: NewAttemptOptions = {},
): CheckoutSubmissionPlan {
  if (pending) {
    if (pending.owner !== (options.owner ?? null)) {
      return { action: "blocked", reason: "owner-mismatch" };
    }
    if (checkoutPayloadFingerprint(pending.payload) === checkoutPayloadFingerprint(payload)) {
      return { action: "retry", attempt: pending };
    }
    return { action: "blocked", attempt: pending, reason: "payload-changed" };
  }
  return { action: "create", attempt: createCheckoutAttempt(payload, options) };
}

/**
 * Inspects the persisted attempt without ever returning another account's
 * payload. A mismatch still reports the presence of an unresolved attempt so
 * callers must block creation and require an explicit abandon.
 */
export function inspectCheckoutAttempt(
  owner?: string | null,
  storage?: CheckoutStorage,
): CheckoutAttemptState {
  const read = readStoredAttempt(storage);
  if (read.status === "present") {
    if (read.attempt.owner !== (owner ?? null)) return { status: "owner-mismatch" };
    return { status: "owned", attempt: read.attempt };
  }
  return read;
}

/**
 * Low-level read used by diagnostics/tests. Unlike inspectCheckoutAttempt this
 * returns an attempt owned by another account, so it must never be rendered
 * or used as a create decision. The owner argument is intentionally ignored:
 * loading must not hide an unresolved attempt from the caller.
 */
export function loadCheckoutAttempt(
  _owner?: string | null,
  storage?: CheckoutStorage,
): CheckoutAttempt | null {
  const read = readStoredAttempt(storage);
  return read.status === "present" ? read.attempt : null;
}

export function saveCheckoutAttempt(attempt: CheckoutAttempt, storage?: CheckoutStorage): void {
  let target: CheckoutStorage;
  try {
    target = storageOrDefault(storage);
  } catch (error) {
    throw error instanceof CheckoutAttemptStorageError
      ? error
      : new CheckoutAttemptStorageError("unavailable", "Browser storage is unavailable");
  }

  const serialized = JSON.stringify(attempt);
  try {
    target.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, serialized);
  } catch (error) {
    throw new CheckoutAttemptStorageError(
      storageWriteErrorCode(error),
      "Could not persist the checkout attempt",
    );
  }

  let readBack: string | null;
  try {
    readBack = target.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  } catch {
    throw new CheckoutAttemptStorageError(
      "verification-failed",
      "Could not verify the persisted checkout attempt",
    );
  }
  if (readBack !== serialized) {
    throw new CheckoutAttemptStorageError(
      "verification-failed",
      "The persisted checkout attempt did not match the requested attempt",
    );
  }
}

export function clearCheckoutAttempt(storage?: CheckoutStorage): void {
  let target: CheckoutStorage;
  try {
    target = storageOrDefault(storage);
  } catch (error) {
    throw error instanceof CheckoutAttemptStorageError
      ? error
      : new CheckoutAttemptStorageError("unavailable", "Browser storage is unavailable");
  }

  try {
    target.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  } catch (error) {
    throw new CheckoutAttemptStorageError(
      storageWriteErrorCode(error),
      "Could not clear the checkout attempt",
    );
  }

  try {
    if (target.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) !== null) {
      throw new CheckoutAttemptStorageError(
        "verification-failed",
        "The checkout attempt is still present after clearing",
      );
    }
  } catch (error) {
    if (error instanceof CheckoutAttemptStorageError) throw error;
    throw new CheckoutAttemptStorageError(
      "verification-failed",
      "Could not verify that the checkout attempt was cleared",
    );
  }
}

function readCompletionRecord(storage?: CheckoutStorage): CompletionLookup {
  let target: CheckoutStorage;
  try {
    target = storageOrDefault(storage);
  } catch (error) {
    return { status: "unavailable", error };
  }

  let stored: string | null;
  try {
    stored = target.getItem(CHECKOUT_COMPLETION_STORAGE_KEY);
  } catch (error) {
    return { status: "unavailable", error };
  }
  if (stored === null) return { status: "none" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return { status: "none" };
  }
  if (!isCompletionRecord(parsed)) return { status: "none" };
  return { status: "present", completion: parsed };
}

/**
 * Only a submission that was already waiting when the order was confirmed may
 * reuse it. A new click, even with an identical payload a moment later, has a
 * different waiter id and therefore creates a fresh idempotency key.
 */
function completionReusableFor(
  completion: CompletionRecord,
  owner: string | null,
  payload: CreateOrderPayload,
  submissionId: string,
): boolean {
  return (
    completion.attempt.owner === owner &&
    checkoutPayloadFingerprint(completion.attempt.payload) ===
      checkoutPayloadFingerprint(payload) &&
    completion.waiterIds.includes(submissionId)
  );
}

function completionMatchesAttempt(completion: CompletionRecord, attempt: CheckoutAttempt): boolean {
  return (
    completion.attempt.idempotencyKey === attempt.idempotencyKey &&
    completion.attempt.owner === attempt.owner &&
    checkoutPayloadFingerprint(completion.attempt.payload) ===
      checkoutPayloadFingerprint(attempt.payload)
  );
}

function consumeCompletionWaiter(
  completion: CompletionRecord,
  submissionId: string,
  storage?: CheckoutStorage,
): void {
  const remaining = completion.waiterIds.filter((id) => id !== submissionId);
  try {
    const target = storageOrDefault(storage);
    if (remaining.length === 0) {
      target.removeItem(CHECKOUT_COMPLETION_STORAGE_KEY);
      return;
    }
    target.setItem(
      CHECKOUT_COMPLETION_STORAGE_KEY,
      JSON.stringify({ ...completion, waiterIds: remaining }),
    );
  } catch {
    // A leftover claim is inert: waiter ids are never reused by another run.
  }
}

function saveCheckoutCompletion(
  attempt: CheckoutAttempt,
  orderNumber: string,
  waiterIds: string[],
  storage?: CheckoutStorage,
): void {
  const target = storageOrDefault(storage);
  const completion: CompletionRecord = {
    attempt,
    orderNumber,
    completedAt: new Date().toISOString(),
    waiterIds,
  };
  try {
    target.setItem(CHECKOUT_COMPLETION_STORAGE_KEY, JSON.stringify(completion));
  } catch (error) {
    throw new CheckoutAttemptStorageError(
      storageWriteErrorCode(error),
      "Could not remember the completed checkout",
    );
  }
}

export function clearCheckoutCompletion(storage?: CheckoutStorage): void {
  const target = storageOrDefault(storage);
  try {
    target.removeItem(CHECKOUT_COMPLETION_STORAGE_KEY);
  } catch (error) {
    throw new CheckoutAttemptStorageError(
      storageWriteErrorCode(error),
      "Could not clear the completed checkout",
    );
  }
}

function storageWarning(error: unknown): string {
  if (error instanceof CheckoutAttemptStorageError && error.code === "quota-exceeded") {
    return "Bộ nhớ trình duyệt đã đầy nên không thể cập nhật bản ghi đơn hàng.";
  }
  return "Không thể cập nhật bản ghi đơn hàng trên trình duyệt.";
}

function browserLockManager(): CheckoutLockManager | null {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as unknown as { locks?: CheckoutLockManager }).locks;
  return locks && typeof locks.request === "function" ? locks : null;
}

/**
 * Serializes checkout mutations across tabs with Web Locks. When the browser
 * does not expose Web Locks we fail closed instead of inventing an unsafe
 * localStorage lock.
 */
export async function withCheckoutLock<T>(
  operation: () => Promise<T> | T,
  options: { lockManager?: CheckoutLockManager | null } = {},
): Promise<T> {
  const locks = options.lockManager === undefined ? browserLockManager() : options.lockManager;
  if (!locks) throw new CheckoutLockUnavailableError();
  return locks.request(CHECKOUT_LOCK_NAME, { mode: "exclusive" }, operation);
}

/**
 * Runs the whole create/replay transaction inside one cross-tab lock:
 * re-read the attempt, decide using the persisted copy, persist before POST,
 * then keep or clear the attempt based on the outcome.
 *
 * Waiter bookkeeping is a read-modify-write over a single shared record, so
 * registration and cleanup use the same global checkout lock. Registration is
 * its own short lock phase: callers that start together are all recorded before
 * either can submit, but the lock is not held while the caller is merely
 * queued. The lock is then released so the first tab can perform its network
 * request without blocking the waiting tabs' registration. Cleanup runs inside
 * the submission lock so a completed or failed run cannot leave a waiter that
 * would make a later, intentional purchase look like the same race.
 */
export async function runCheckoutSubmission(
  options: RunCheckoutSubmissionOptions,
): Promise<CheckoutSubmissionOutcome> {
  const startedAt = options.now?.() ?? Date.now();
  const submissionId = newCheckoutIdempotencyKey();
  const lockOptions = { lockManager: options.lockManager };

  try {
    await withCheckoutLock(() => {
      registerCheckoutWaiter(
        {
          id: submissionId,
          owner: options.owner,
          fingerprint: checkoutPayloadFingerprint(options.payload),
          createdAt: startedAt,
        },
        options.storage,
      );
    }, lockOptions);
  } catch (error) {
    if (error instanceof CheckoutLockUnavailableError) {
      return { status: "blocked", reason: "lock-unavailable", error };
    }
    throw error;
  }

  let waiterCleaned = false;
  const cleanupWaiter = () => {
    if (waiterCleaned) return;
    waiterCleaned = true;
    unregisterCheckoutWaiter(submissionId, options.storage);
  };
  const cleanupWaiterUnderLock = async () => {
    if (waiterCleaned) return;
    try {
      await withCheckoutLock(cleanupWaiter, lockOptions);
    } catch {
      // The waiter expires by TTL; never mutate the shared record without
      // atomic serialization.
    }
  };

  try {
    return await withCheckoutLock(async (): Promise<CheckoutSubmissionOutcome> => {
      try {
        return await submitCheckoutAttempt(options, submissionId);
      } finally {
        cleanupWaiter();
      }
    }, lockOptions);
  } catch (error) {
    await cleanupWaiterUnderLock();
    if (error instanceof CheckoutLockUnavailableError) {
      return { status: "blocked", reason: "lock-unavailable", error };
    }
    throw error;
  }
}

async function submitCheckoutAttempt(
  options: RunCheckoutSubmissionOptions,
  submissionId: string,
): Promise<CheckoutSubmissionOutcome> {
  const state = inspectCheckoutAttempt(options.owner, options.storage);
  if (state.status === "unavailable") {
    return { status: "blocked", reason: "storage-unavailable", error: state.error };
  }
  if (state.status === "invalid") {
    return { status: "blocked", reason: "invalid-attempt" };
  }
  if (state.status === "owner-mismatch") {
    return { status: "blocked", reason: "owner-mismatch" };
  }

  let completion: CompletionRecord | null = null;
  if (state.status !== "owned" || options.mode !== "retry") {
    const completionRead = readCompletionRecord(options.storage);
    if (completionRead.status === "unavailable" && state.status === "none") {
      return {
        status: "blocked",
        reason: "storage-unavailable",
        error: completionRead.error,
      };
    }
    if (completionRead.status === "present") completion = completionRead.completion;
  }

  if (
    completion &&
    completionReusableFor(completion, options.owner, options.payload, submissionId)
  ) {
    let warning: string | undefined;
    let attemptCleared = true;
    if (state.status === "owned" && completionMatchesAttempt(completion, state.attempt)) {
      try {
        clearCheckoutAttempt(options.storage);
      } catch (error) {
        attemptCleared = false;
        warning = storageWarning(error);
      }
    }
    if (attemptCleared) {
      consumeCompletionWaiter(completion, submissionId, options.storage);
    }
    return {
      status: "created",
      attempt: completion.attempt,
      orderNumber: completion.orderNumber,
      reusedCompletion: true,
      storageWarning: warning,
    };
  }

  let attempt: CheckoutAttempt;

  if (state.status === "owned") {
    if (options.mode === "retry") {
      attempt = state.attempt;
    } else if (completion && completionMatchesAttempt(completion, state.attempt)) {
      // The pending attempt already produced an order and was retained
      // only so a concurrent tab could replay it. This submission is a
      // new intent, so it must be allowed to create a fresh key.
      const created = createCheckoutAttempt(options.payload, {
        owner: options.owner,
        idempotencyKey: options.idempotencyKey,
      });
      try {
        saveCheckoutAttempt(created, options.storage);
      } catch (error) {
        return { status: "blocked", reason: "storage-write-failed", error };
      }
      attempt = created;
    } else {
      const plan = planCheckoutSubmission(state.attempt, options.payload, {
        owner: options.owner,
      });
      if (plan.action === "blocked") {
        return { status: "blocked", reason: plan.reason };
      }
      attempt = plan.attempt;
    }
  } else if (options.mode === "retry") {
    return { status: "blocked", reason: "attempt-missing" };
  } else {
    const created = createCheckoutAttempt(options.payload, {
      owner: options.owner,
      idempotencyKey: options.idempotencyKey,
    });
    try {
      saveCheckoutAttempt(created, options.storage);
    } catch (error) {
      return { status: "blocked", reason: "storage-write-failed", error };
    }
    attempt = created;
  }

  try {
    const order = await options.submit(attempt);
    const waiters = otherWaiterIds(
      options.owner,
      checkoutPayloadFingerprint(attempt.payload),
      submissionId,
      options.storage,
      options.now?.() ?? Date.now(),
    );
    let warning: string | undefined;
    let completionSaved = false;
    // A completion marker is written only for a tab that was already
    // waiting. With no waiter there is nothing to deduplicate, so the
    // attempt is simply cleared and a later purchase starts fresh.
    if (waiters.length > 0) {
      try {
        saveCheckoutCompletion(attempt, order.orderNumber, waiters, options.storage);
        completionSaved = true;
      } catch (error) {
        warning = storageWarning(error);
      }
    }
    if (waiters.length === 0 || completionSaved) {
      try {
        clearCheckoutAttempt(options.storage);
      } catch (error) {
        warning = warning ?? storageWarning(error);
      }
    }
    return {
      status: "created",
      attempt,
      orderNumber: order.orderNumber,
      reusedCompletion: false,
      storageWarning: warning,
    };
  } catch (error) {
    if (isUncertainCheckoutError(error)) {
      return { status: "retained", attempt, reason: "uncertain", error };
    }
    if (isIdempotencyConflict(error)) {
      return { status: "retained", attempt, reason: "idempotency-conflict", error };
    }

    let warning: string | undefined;
    try {
      clearCheckoutAttempt(options.storage);
    } catch (clearError) {
      warning = storageWarning(clearError);
    }
    return { status: "failed", error, storageWarning: warning };
  }
}

/**
 * A result is uncertain when the request may have reached the server but no
 * conclusive response was received. Definitive 4xx responses mean no order was
 * created for this attempt.
 */
export function isUncertainCheckoutError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 408 || error.status >= 500;
  return true;
}

/**
 * A key reused with a different canonical payload is a definitive conflict.
 * The UI must keep the attempt and require an explicit abandon instead of
 * silently minting another key.
 */
export function isIdempotencyConflict(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.message.includes("idempotency key was already used")
  );
}

/**
 * Reads the authenticated customer id from the JWT payload so an uncertain
 * attempt is only offered to the same customer. The token is not trusted for
 * authorization; the API verifies it.
 */
export function checkoutOwnerFromToken(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return null;
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { id?: unknown; sub?: unknown };
    if (typeof payload.id === "number" || typeof payload.id === "string") {
      return String(payload.id);
    }
    if (typeof payload.sub === "string") return payload.sub;
  } catch {
    return null;
  }
  return null;
}
