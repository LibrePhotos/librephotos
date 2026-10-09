/**
 * A login against a backend that is down or still starting (no answer at all,
 * or the proxy's 502-504) said nothing: only a 401 and a 500 were reported.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
import { isBackendUnreachable, useLoginMutation } from "./useLoginMutation";

const stubs = vi.hoisted(() => ({
  post: vi.fn(),
  backendUnreachable: vi.fn(),
  navigate: vi.fn(),
  setAuthCookie: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => stubs.navigate }));
vi.mock("../../../service/notifications", () => ({
  notification: new Proxy(
    {},
    { get: (_target, name) => (name === "backendUnreachable" ? stubs.backendUnreachable : () => {}) }
  ),
}));
vi.mock("../../authCookies", async importOriginal => ({
  ...(await importOriginal<typeof import("../../authCookies")>()),
  setAuthCookie: stubs.setAuthCookie,
}));
vi.mock("../../api", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api")>()),
  fetchClient: { post: (...args: unknown[]) => stubs.post(...args) },
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  stubs.post.mockReset();
  stubs.backendUnreachable.mockReset();
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

describe("isBackendUnreachable", () => {
  it("is true without an answer and for the proxy's gateway errors", () => {
    expect(isBackendUnreachable(new TypeError("Failed to fetch"))).toBe(true);
    expect(isBackendUnreachable(new ApiError("Bad Gateway", 502))).toBe(true);
    expect(isBackendUnreachable(new ApiError("Gateway Timeout", 504))).toBe(true);
  });

  it("is false for answers that are reported elsewhere", () => {
    expect(isBackendUnreachable(new ApiError("Unauthorized", 401))).toBe(false);
    expect(isBackendUnreachable(new ApiError("Internal Server Error", 500))).toBe(false);
    expect(isBackendUnreachable(new Error("parse"))).toBe(false);
  });
});

describe("useLoginMutation", () => {
  it("says the server cannot be reached when the request gets no answer", async () => {
    stubs.post.mockRejectedValue(new TypeError("Failed to fetch"));

    await logIn();

    expect(stubs.backendUnreachable).toHaveBeenCalledTimes(1);
  });

  // A "logged out" answer cached earlier in the tab (sign-up never observes the
  // query) bounced the protected shell back to /login until its refetch landed.
  it("marks the session signed in before going home", async () => {
    stubs.post.mockResolvedValue({ access: "access-token", refresh: "refresh-token" });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(["isAuthenticated"], false);

    await logIn(client);

    expect(stubs.setAuthCookie).toHaveBeenCalledWith("access", "access-token");
    expect(stubs.setAuthCookie).toHaveBeenCalledWith("refresh", "refresh-token");
    expect(client.getQueryData(["isAuthenticated"])).toBe(true);
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/" });
    expect(stubs.backendUnreachable).not.toHaveBeenCalled();
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

    await logIn();

    expect(stubs.backendUnreachable).not.toHaveBeenCalled();
  });
});
