/**
 * A failed save used to be silent unless it was a 500: favouriting, hiding, renaming, a stack change
 * or a site setting that the server refused (400/403/404/409), a 502 from the proxy or a network
 * error reached only the hook's own `onError`, and most hooks had none (#2222).
 *
 * The QueryClient's MutationCache now reports every failed mutation once, unless someone else
 * already does: the transport (a 500 toast, a 401 logout), the hook's own `onError`, or a caller
 * that shows the error itself and says so (`{ reportsErrors: true }`, `mutationErrorMeta`).
 */
import { ResponseParseError } from "@librephotos/api-client";
import { MutationObserver, type MutationMeta } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToastOptions } from "../service/notifications/toast";
import { ApiError, queryClient } from "./api";
import { mutationErrorMeta } from "./mutationErrors";

const toasts = vi.hoisted(() => ({
  error: vi.fn<(message: ReactNode, options?: ToastOptions) => void>(),
}));

vi.mock("../service/notifications/toast", () => ({
  toast: { error: toasts.error, success: () => {}, warning: () => {}, hide: () => {} },
}));

type Options = { meta?: MutationMeta; onError?: () => void };

/** Run one mutation through the app's QueryClient that rejects with `error`. */
async function failWith(error: unknown, options: Options = {}) {
  const observer = new MutationObserver(queryClient, { mutationFn: () => Promise.reject(error), ...options });
  await observer.mutate().catch(() => {});
}

beforeEach(() => {
  toasts.error.mockReset();
});

describe("a failed mutation", () => {
  it("shows the server's message for a refused change", async () => {
    await failWith(new ApiError("Bad Request", 400, "An album with this title already exists.", "/albums/user/1/"));

    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(toasts.error.mock.calls[0]?.[0]).toBe("An album with this title already exists.");
  });

  it("says the change failed when the server sent no message (a 502 from the proxy)", async () => {
    await failWith(new ApiError("API error: 502 Bad Gateway", 502, null, "/photosedit/favorite/"));

    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(toasts.error.mock.calls[0]?.[0]).not.toContain("502 Bad Gateway");
  });

  it("is reported when the request never reached the server", async () => {
    await failWith(new TypeError("Failed to fetch"));

    expect(toasts.error).toHaveBeenCalledTimes(1);
  });

  it.each([500, 401])("leaves a %i to the transport, which already reported it", async status => {
    await failWith(new ApiError("handled", status, null, "/photosedit/hide/"));

    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("is reported for a hook whose callers do not report errors themselves", async () => {
    await failWith(new ApiError("Bad Request", 400, "nope", "/user/1/"), { meta: mutationErrorMeta() });

    expect(toasts.error).toHaveBeenCalledTimes(1);
  });

  it("leaves a mutation with its own onError alone", async () => {
    await failWith(new ApiError("Bad Request", 400, "nope", "/jobs/1/"), { onError: () => {} });

    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("stays quiet when the caller shows the error itself", async () => {
    await failWith(new ApiError("Bad Request", 400, "nope", "/user/1/"), {
      meta: mutationErrorMeta({ reportsErrors: true }),
    });

    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("reports a response that did not match its schema once, as a parse error", async () => {
    await failWith(new ResponseParseError("rename album", "title: expected string"));

    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(String(toasts.error.mock.calls[0]?.[0])).toContain("title: expected string");
  });
});
