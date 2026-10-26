import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authApi } from "@/lib/auth";
import { useAuth } from "./useAuth";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, authApi: { ...actual.authApi, login: vi.fn() } };
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe("useAuth", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    push.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("restores a customer session, logs in, and logs out", async () => {
    sessionStorage.setItem("store-token", "old-token");
    vi.mocked(authApi.login).mockResolvedValue({
      accessToken: "customer-token",
      tokenType: "Bearer",
      expiresIn: 1800,
      user: {
        id: 2,
        username: "buyer",
        email: "buyer@example.com",
        roles: ["customer"],
        groups: ["customers"],
      },
    });
    const { result } = renderHook(() => useAuth({ redirectTo: "/", logoutTo: "/login" }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.isAuthenticated).toBe(true);

    await act(async () => {
      await result.current.login.mutateAsync({
        username: "buyer",
        password: "secret123",
        remember: true,
      });
    });
    expect(localStorage.getItem("store-token")).toBe("customer-token");
    expect(authApi.login).toHaveBeenCalledWith(
      { username: "buyer", password: "secret123" },
      "customer",
    );
    expect(push).toHaveBeenCalledWith("/");

    act(() => result.current.logout());
    expect(result.current.isAuthenticated).toBe(false);
    expect(localStorage.getItem("store-token")).toBeNull();
    expect(push).toHaveBeenLastCalledWith("/login");
  });

  it("selects the admin login portal", async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      accessToken: "admin-token",
      tokenType: "Bearer",
      expiresIn: 1800,
      user: {
        id: 1,
        username: "admin",
        email: "admin@example.com",
        roles: ["admin"],
        groups: ["administrators"],
      },
    });
    const { result } = renderHook(() => useAuth({ storageKey: "admin-token", portal: "admin" }), {
      wrapper,
    });
    await act(async () => {
      await result.current.login.mutateAsync({ username: "admin", password: "secret123" });
    });
    expect(authApi.login).toHaveBeenCalledWith(
      { username: "admin", password: "secret123" },
      "admin",
    );
    expect(sessionStorage.getItem("admin-token")).toBe("admin-token");
  });
});
