/**
 * Signing in. A login against a backend that is down or still starting (no
 * answer at all, or the proxy's 502-504) used to toast "try again in a few
 * minutes"; BackendStatusGate's screen took that over (#2310).
 */
import { authKeys } from "@librephotos/api-client";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
import { reportMutationError } from "../../mutationErrors";
import { useLoginMutation } from "./useLoginMutation";

const stubs = vi.hoisted(() => ({
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  saveFailed: vi.fn<(message: string | null) => void>(),
  navigate: vi.fn<(options: { to?: string; href?: string }) => void>(),
  setAuthCookie: vi.fn<(name: "access" | "refresh", value: string) => void>(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => stubs.navigate }));
vi.mock("../../../service/notifications", () => ({
  notification: new Proxy({}, { get: (_target, name) => (name === "saveFailed" ? stubs.saveFailed : () => {}) }),
}));
vi.mock("../../authCookies", async importOriginal => ({
  ...(await importOriginal<typeof import("../../authCookies")>()),
  setAuthCookie: stubs.setAuthCookie,
}));
vi.mock("../../api", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api")>()),
  apiClient: { post: (...args: Parameters<typeof stubs.post>) => stubs.post(...args) },
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  stubs.post.mockReset();
  stubs.saveFailed.mockReset();
  stubs.navigate.mockReset();
  stubs.setAuthCookie.mockReset();
});

function LogIn({ redirectTo }: { redirectTo?: string }) {
  const { mutate } = useLoginMutation({ redirectTo });
  useEffect(() => mutate({ username: "alice", password: "secret" }), [mutate]);
  return null;
}

async function logIn(
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
  redirectTo?: string
) {
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <LogIn redirectTo={redirectTo} />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await act(async () => root.unmount());
  return client;
}

describe("useLoginMutation", () => {
  // The gate shows the "not answering" screen; a "could not save" toast on top said nothing more.
  it("leaves an unreachable backend to BackendStatusGate", async () => {
    stubs.post.mockRejectedValue(new TypeError("Failed to fetch"));
    const client = new QueryClient({
      mutationCache: new MutationCache({ onError: (error, _v, _r, mutation) => reportMutationError(error, mutation) }),
      defaultOptions: { mutations: { retry: false } },
    });

    await logIn(client);

    expect(stubs.saveFailed).not.toHaveBeenCalled();
    expect(stubs.navigate).not.toHaveBeenCalled();
  });

  // A "logged out" answer cached earlier in the tab (sign-up never observes the
  // query) bounced the protected shell back to /login until its refetch landed.
  it("marks the session signed in before going home", async () => {
    stubs.post.mockResolvedValue({ access: "access-token", refresh: "refresh-token" });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(authKeys.isAuthenticated(), false);

    await logIn(client);

    expect(stubs.setAuthCookie).toHaveBeenCalledWith("access", "access-token");
    expect(stubs.setAuthCookie).toHaveBeenCalledWith("refresh", "refresh-token");
    expect(client.getQueryData(authKeys.isAuthenticated())).toBe(true);
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/" });
  });

  // The protected shell sends /login?redirect=<path+query>; the visitor came
  // back to the timeline instead of the page they had opened.
  it("returns to the page that asked for the login, query string included", async () => {
    stubs.post.mockResolvedValue({ access: "access-token", refresh: "refresh-token" });

    await logIn(undefined, "/search/beach?type=video");

    expect(stubs.navigate).toHaveBeenCalledWith({ href: "/search/beach?type=video" });
  });

  it.each(["//evil.example/", "/\\evil.example/", "https://evil.example/", "/\t/evil.example/"])(
    "goes home instead of to another site (%j)",
    async redirectTo => {
      stubs.post.mockResolvedValue({ access: "access-token", refresh: "refresh-token" });

      await logIn(undefined, redirectTo);

      expect(stubs.navigate).toHaveBeenCalledWith({ to: "/" });
    }
  );

  it("leaves wrong credentials to the 401 handler", async () => {
    stubs.post.mockRejectedValue(new ApiError("Authentication failed", 401));
    const client = new QueryClient({
      mutationCache: new MutationCache({ onError: (error, _v, _r, mutation) => reportMutationError(error, mutation) }),
      defaultOptions: { mutations: { retry: false } },
    });

    await logIn(client);

    expect(stubs.saveFailed).not.toHaveBeenCalled();
  });
});
