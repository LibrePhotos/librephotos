/**
 * Log out means logged out, whatever the server answers. A second click finds
 * the refresh token already blacklisted and gets a 401; clearing the cookies
 * only on success left that user signed in.
 *
 * It ends in a full page load of the login page: a router navigation kept the
 * cached "logged in" answer, so /login sent the user straight back into the app.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useLogoutMutation } from "./useLogoutMutation";

const post = vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>();
const redirectToLogin = vi.fn<() => void>();

vi.mock("../../api", () => ({
  fetchClient: { post: (...args: Parameters<typeof post>) => post(...args) },
  redirectToLogin: () => redirectToLogin(),
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  redirectToLogin.mockReset();
  post.mockReset();
  window.history.pushState({}, "", "/search/hdr_hlg_hevc");
  document.cookie = "access=a; path=/";
  document.cookie = "refresh=r; path=/";
});

function LogOut() {
  const { mutate } = useLogoutMutation();
  useEffect(() => mutate(), [mutate]);
  return null;
}

async function logOut() {
  const container = document.createElement("div");
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <LogOut />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => root.unmount());
}

describe("useLogoutMutation", () => {
  it("clears the session and reloads into the login page", async () => {
    post.mockResolvedValue({});

    await logOut();

    expect(post).toHaveBeenCalledWith("/auth/token/blacklist/", { refresh: "r" });
    expect(document.cookie).toBe("");
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });

  it("clears it too when the server refuses the already-blacklisted token", async () => {
    post.mockRejectedValue(new Error("401"));

    await logOut();

    expect(document.cookie).toBe("");
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });
});
