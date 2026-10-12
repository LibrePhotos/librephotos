/**
 * The first-time-setup query was keyed `[["isFirstTimeSetup"]]` (the key array wrapped in another
 * array) while sign-up invalidated `["isFirstTimeSetup"]`, which does not match it. After the first
 * admin signed up, the login page kept the cached "first time setup" answer for the whole stale time.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { queryClient } from "../../api";
import { useIsFirstTimeSetupQuery } from "./useIsFirstTimeSetupQuery";
import { useSignUpMutation } from "./useSignUpMutation";

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
}));

vi.mock("../../api", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api")>()),
  fetchClient: {
    get: (...args: Parameters<typeof stubs.get>) => stubs.get(...args),
    post: (...args: Parameters<typeof stubs.post>) => stubs.post(...args),
  },
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const settle = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });

describe("useSignUpMutation", () => {
  it("refreshes the first-time-setup answer", async () => {
    stubs.get.mockResolvedValueOnce({ isFirstTimeSetup: true }).mockResolvedValue({ isFirstTimeSetup: false });
    stubs.post.mockResolvedValue({ username: "admin", email: "", first_name: "", last_name: "" });

    let firstTimeSetup: boolean | undefined;
    let signUp: ReturnType<typeof useSignUpMutation> | undefined;
    function Probe() {
      firstTimeSetup = useIsFirstTimeSetupQuery().data;
      signUp = useSignUpMutation();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      );
    });
    await settle();
    expect(firstTimeSetup).toBe(true);

    await act(async () => {
      await defined(signUp).mutateAsync({ username: "admin", password: "x", email: "", first_name: "", last_name: "" });
    });
    await settle();

    expect(firstTimeSetup).toBe(false);
    await act(async () => root.unmount());
    queryClient.clear();
  });
});
