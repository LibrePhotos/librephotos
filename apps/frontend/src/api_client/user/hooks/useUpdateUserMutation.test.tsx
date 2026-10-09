/**
 * The photo grid saves its display preferences (thumbnail size, alignment,
 * header size) through this hook after every pause of the slider. Each save
 * used to pop a "<user>'s info updated" toast: the grid asked for silence with
 * a per-call `context`, which TanStack Query v5 never reads.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { useUpdateUserMutation } from "./useUpdateUserMutation";

const mocks = vi.hoisted(() => ({
  patch: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  invalidateQueries: vi.fn<(filters: { queryKey: readonly unknown[] }) => void>(),
  updateUser: vi.fn<(username: string) => void>(),
}));

vi.mock("../../api", () => ({
  fetchClient: { patch: mocks.patch },
  queryClient: { invalidateQueries: mocks.invalidateQueries },
}));
vi.mock("../../../service/notifications", () => ({ notification: { updateUser: mocks.updateUser } }));
// The response shape is not under test here.
vi.mock("../../../util/zodUtils", () => ({ parseWithNotification: (_schema: unknown, data: unknown) => data }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mocks.patch.mockReset().mockResolvedValue({ id: 1, username: "admin" });
  mocks.invalidateQueries.mockClear();
  mocks.updateUser.mockClear();
});

async function saveWith(options?: { silent?: boolean }) {
  let mutation: ReturnType<typeof useUpdateUserMutation> | undefined;
  function Probe() {
    mutation = useUpdateUserMutation(options);
    return null;
  }
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await defined(mutation).mutateAsync({ id: 1, image_scale: 2 });
  });
  await act(async () => {
    root.unmount();
  });
}

describe("useUpdateUserMutation", () => {
  it("confirms a save with a toast by default", async () => {
    await saveWith();

    expect(mocks.patch).toHaveBeenCalledWith("/user/1/", { id: 1, image_scale: 2 });
    expect(mocks.updateUser).toHaveBeenCalledWith("admin");
  });

  it("saves without a toast when created silent", async () => {
    await saveWith({ silent: true });

    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.updateUser).not.toHaveBeenCalled();
    // The profile is still refetched, so the grid sees the new preference.
    expect(mocks.invalidateQueries).toHaveBeenCalled();
  });
});
