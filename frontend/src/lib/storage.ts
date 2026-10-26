export function getAccessToken(key = "store-token"): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
}

export function setAccessToken(token: string, remember: boolean, key = "store-token") {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(key);
  window.localStorage.removeItem(key);
  (remember ? window.localStorage : window.sessionStorage).setItem(key, token);
}

export function clearAccessToken(key = "store-token") {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(key);
  window.localStorage.removeItem(key);
}
