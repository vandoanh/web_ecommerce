"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi, type LoginPortal, type LoginCredentials } from "@/lib/auth";
import { clearAccessToken, getAccessToken, setAccessToken } from "@/lib/storage";

type UseAuthOptions = {
  storageKey?: string;
  redirectTo?: string;
  logoutTo?: string;
  portal?: LoginPortal;
};

type LoginInput = LoginCredentials & { remember?: boolean };

export function useAuth({
  storageKey = "store-token",
  redirectTo = "/",
  logoutTo = "/",
  portal = "customer",
}: UseAuthOptions = {}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      if (canceled) return;
      setToken(getAccessToken(storageKey));
      setReady(true);
    });
    return () => {
      canceled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    const syncToken = () => setToken(getAccessToken(storageKey));
    window.addEventListener("store-auth-change", syncToken);
    return () => window.removeEventListener("store-auth-change", syncToken);
  }, [storageKey]);

  const login = useMutation({
    mutationFn: ({ username, password }: LoginInput) =>
      authApi.login({ username, password }, portal),
    onSuccess: async (data, variables) => {
      setAccessToken(data.accessToken, variables.remember ?? false, storageKey);
      setToken(data.accessToken);
      window.dispatchEvent(new Event("store-auth-change"));
      await queryClient.invalidateQueries();
      router.push(redirectTo);
    },
  });

  const logout = useCallback(() => {
    clearAccessToken(storageKey);
    setToken(null);
    queryClient.clear();
    window.dispatchEvent(new Event("store-auth-change"));
    router.push(logoutTo);
  }, [logoutTo, queryClient, router, storageKey]);

  return {
    token,
    ready,
    isAuthenticated: Boolean(token),
    login,
    logout,
  };
}
