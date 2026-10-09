/**
 * Moving photos to the trash left cached photo details untouched, so the
 * lightbox's Delete/Restore toggle showed the old in_trashcan state when the
 * user stepped back onto the photo. A request that changed nothing also
 * reported "0 photo(s) were moved to trash".
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { useMarkPhotosDeletedMutation } from "./useMarkPhotosDeletedMutation";

const mocks = vi.hoisted(() => ({
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  invalidateQueries: vi.fn<(filters: { queryKey: readonly unknown[] }) => void>(),
  togglePhotoDelete: vi.fn<(isDeleted: boolean, numberOfPhotos: number) => void>(),
}));

vi.mock("../../api", () => ({
  fetchClient: { post: mocks.post },
  queryClient: { invalidateQueries: mocks.invalidateQueries },
}));
vi.mock("../invalidatePhotoLists", () => ({ invalidatePhotoLists: vi.fn<() => void>() }));
vi.mock("../../../service/notifications", () => ({
  notification: { togglePhotoDelete: mocks.togglePhotoDelete },
}));
// The response shape is not under test here.
vi.mock("../../../util/zodUtils", () => ({ parseWithNotification: (_schema: unknown, data: unknown) => data }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mocks.post.mockReset();
  mocks.invalidateQueries.mockClear();
  mocks.togglePhotoDelete.mockClear();
});

async function trash(imageHashes: string[]) {
  let mutation: ReturnType<typeof useMarkPhotosDeletedMutation> | undefined;
  function Probe() {
    mutation = useMarkPhotosDeletedMutation();
    return null;
  }
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await defined(mutation).mutateAsync({ image_hashes: imageHashes, deleted: true });
  });
  await act(async () => {
    root.unmount();
  });
}

describe("useMarkPhotosDeletedMutation", () => {
  it("confirms the move and refreshes cached photo details", async () => {
    mocks.post.mockResolvedValue({ status: true, count: 2 });

    await trash(["a", "b"]);

    expect(mocks.togglePhotoDelete).toHaveBeenCalledWith(true, 2);
    const keys = mocks.invalidateQueries.mock.calls.map(([filters]) => filters.queryKey);
    expect(keys).toContainEqual(["photoDetails"]);
  });

  it("stays quiet when nothing changed", async () => {
    mocks.post.mockResolvedValue({ status: true, count: 0 });

    await trash(["a"]);

    expect(mocks.togglePhotoDelete).not.toHaveBeenCalled();
  });
});
