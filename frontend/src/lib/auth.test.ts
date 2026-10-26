import { afterEach, describe, expect, it, vi } from "vitest";
import { authApi } from "./auth";

describe("authApi.login", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts credentials and returns the token response", async () => {
    const result = {
      accessToken: "jwt",
      tokenType: "Bearer",
      expiresIn: 3600,
      user: {
        id: 1,
        username: "buyer",
        email: "buyer@example.com",
        roles: ["customer"],
        groups: ["customers"],
      },
    };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal("fetch", fetch);

    await expect(authApi.login({ username: "demo", password: "secret" })).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "demo", password: "secret" }),
      }),
    );
  });

  it("uses the admin-only login route when requested", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ accessToken: "admin" }) });
    vi.stubGlobal("fetch", fetch);
    await authApi.login({ username: "admin", password: "secret" }, "admin");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/admin/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("registers a regular customer", async () => {
    const result = { accessToken: "new-customer" };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal("fetch", fetch);
    await expect(
      authApi.register({ username: "buyer", email: "buyer@example.com", password: "secret123" }),
    ).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          username: "buyer",
          email: "buyer@example.com",
          password: "secret123",
        }),
      }),
    );
  });

  it("uses the API error message when login fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Invalid credentials" }),
      }),
    );
    await expect(authApi.login({ username: "demo", password: "bad" })).rejects.toThrow(
      "Invalid credentials",
    );
  });

  it("falls back to the default login error when the response has no message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    await expect(authApi.login({ username: "demo", password: "bad" })).rejects.toThrow(
      "Tên đăng nhập hoặc mật khẩu không chính xác.",
    );
  });
});
