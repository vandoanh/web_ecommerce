import { afterEach, describe, expect, it, vi } from "vitest";
import { authApi } from "./auth";

const customerResponse = {
  accessToken: "customer-jwt",
  tokenType: "Bearer",
  expiresIn: 1800,
  user: {
    id: 1,
    username: "buyer",
    email: "buyer@example.com",
    roles: ["customer"],
    groups: ["customers"],
  },
};

const adminResponse = {
  accessToken: "admin-jwt",
  tokenType: "Bearer",
  expiresIn: 1800,
  user: {
    id: 2,
    username: "admin",
    email: "admin@example.com",
    roles: ["admin"],
    groups: ["administrators"],
  },
};

describe("authApi.login", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts credentials and returns the backend customer response contract", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => customerResponse });
    vi.stubGlobal("fetch", fetch);

    const response = await authApi.login({ username: "demo", password: "secret" });
    expect(response).toEqual(customerResponse);
    expect(response.accessToken).toBe("customer-jwt");
    expect(response.tokenType).toBe("Bearer");
    expect(response.expiresIn).toBe(1800);
    expect(response.user).toEqual({
      id: 1,
      username: "buyer",
      email: "buyer@example.com",
      roles: ["customer"],
      groups: ["customers"],
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "demo", password: "secret" }),
      }),
    );
  });

  it("uses the admin-only login route and returns the backend admin response contract", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => adminResponse });
    vi.stubGlobal("fetch", fetch);
    const response = await authApi.login({ username: "admin", password: "secret" }, "admin");
    expect(response).toEqual(adminResponse);
    expect(response.accessToken).toBe("admin-jwt");
    expect(response.tokenType).toBe("Bearer");
    expect(response.expiresIn).toBe(1800);
    expect(response.user).toEqual({
      id: 2,
      username: "admin",
      email: "admin@example.com",
      roles: ["admin"],
      groups: ["administrators"],
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/admin/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("registers a regular customer and returns the backend response contract", async () => {
    const result = {
      ...customerResponse,
      accessToken: "new-customer-jwt",
      user: {
        ...customerResponse.user,
        id: 3,
        username: "new-buyer",
        email: "new-buyer@example.com",
      },
    };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal("fetch", fetch);
    const response = await authApi.register({
      username: "new-buyer",
      email: "new-buyer@example.com",
      password: "secret123",
    });
    expect(response).toEqual(result);
    expect(response.accessToken).toBe("new-customer-jwt");
    expect(response.tokenType).toBe("Bearer");
    expect(response.expiresIn).toBe(1800);
    expect(response.user).toEqual({
      id: 3,
      username: "new-buyer",
      email: "new-buyer@example.com",
      roles: ["customer"],
      groups: ["customers"],
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          username: "new-buyer",
          email: "new-buyer@example.com",
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
