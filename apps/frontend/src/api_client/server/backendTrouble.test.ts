/**
 * Which failed requests count as "the server is down or starting" (#2310): no answer at all, or a
 * proxy's 502-504. Only the first one since the server last served is reported to the listeners.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../apiError";
import {
  backendTroubleSince,
  clearBackendTrouble,
  isBackendUnreachable,
  reportRequestFailure,
  subscribeBackendTrouble,
} from "./backendTrouble";

afterEach(() => clearBackendTrouble());

describe("isBackendUnreachable", () => {
  it("is true without an answer and for the proxy's gateway errors", () => {
    expect(isBackendUnreachable(new TypeError("Failed to fetch"))).toBe(true);
    expect(isBackendUnreachable(new ApiError("Bad Gateway", 502))).toBe(true);
    expect(isBackendUnreachable(new ApiError("Service Unavailable", 503))).toBe(true);
    expect(isBackendUnreachable(new ApiError("Gateway Timeout", 504))).toBe(true);
  });

  it("is false for answers that are reported elsewhere", () => {
    expect(isBackendUnreachable(new ApiError("Unauthorized", 401))).toBe(false);
    expect(isBackendUnreachable(new ApiError("Internal Server Error", 500))).toBe(false);
    expect(isBackendUnreachable(new Error("parse"))).toBe(false);
  });
});

describe("reportRequestFailure", () => {
  it("tells the listeners once, until the server serves again", () => {
    const listener = vi.fn<() => void>();
    const unsubscribe = subscribeBackendTrouble(listener);

    reportRequestFailure(new ApiError("Internal Server Error", 500));
    expect(backendTroubleSince()).toBeNull();

    reportRequestFailure(new TypeError("Failed to fetch"));
    reportRequestFailure(new ApiError("Bad Gateway", 502));
    expect(backendTroubleSince()).not.toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);

    clearBackendTrouble();
    clearBackendTrouble();
    expect(backendTroubleSince()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    reportRequestFailure(new TypeError("Failed to fetch"));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
