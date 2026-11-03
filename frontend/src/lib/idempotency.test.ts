import { afterEach, describe, expect, it, vi } from "vitest";
import { newIdempotencyKey } from "./idempotency";

describe("newIdempotencyKey", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the browser UUID generator when available", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "9d77cd79-d774-45d0-a960-566b94069386" });
    expect(newIdempotencyKey()).toBe("9d77cd79-d774-45d0-a960-566b94069386");
  });

  it("falls back to a UUID v4-shaped key without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", undefined);
    expect(newIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
