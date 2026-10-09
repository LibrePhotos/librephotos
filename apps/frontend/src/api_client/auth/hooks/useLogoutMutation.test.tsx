/**
 * Log out means logged out, whatever the server answers. A second click finds
 * the refresh token already blacklisted and gets a 401; clearing the cookies
 * only on success left that user signed in.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useLogoutMutation } from "./useLogoutMutation";

const navigate = vi.fn();
const post = vi.fn();

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../../api", () => ({ fetchClient: { post: (...args: unknown[]) => post(...args) } }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  navigate.mockClear();
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
  it("clears the session and goes to the login page", async () => {
    post.mockResolvedValue({});

    await logOut();

    expect(post).toHaveBeenCalledWith("/auth/token/blacklist/", { refresh: "r" });
    expect(document.cookie).toBe("");
    expect(navigate).toHaveBeenCalledWith({ to: "/login" });
  });

  it("clears it too when the server refuses the already-blacklisted token", async () => {
    post.mockRejectedValue(new Error("401"));

    await logOut();

    expect(document.cookie).toBe("");
    expect(navigate).toHaveBeenCalledWith({ to: "/login" });
  });
});
