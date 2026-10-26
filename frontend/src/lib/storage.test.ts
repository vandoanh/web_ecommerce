import { beforeEach, describe, expect, it } from "vitest";
import { clearAccessToken, getAccessToken, setAccessToken } from "./storage";

describe("access token storage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("stores remembered tokens in local storage", () => {
    setAccessToken("saved", true);
    expect(getAccessToken()).toBe("saved");
    expect(localStorage.getItem("store-token")).toBe("saved");
    expect(sessionStorage.getItem("store-token")).toBeNull();
  });

  it("stores non-remembered tokens in session storage and replaces old values", () => {
    localStorage.setItem("store-token", "old");
    setAccessToken("temporary", false);
    expect(getAccessToken()).toBe("temporary");
    expect(localStorage.getItem("store-token")).toBeNull();
    expect(sessionStorage.getItem("store-token")).toBe("temporary");
  });

  it("clears both storage locations for a custom key", () => {
    localStorage.setItem("custom", "saved");
    sessionStorage.setItem("custom", "temporary");
    clearAccessToken("custom");
    expect(getAccessToken("custom")).toBeNull();
  });
});
