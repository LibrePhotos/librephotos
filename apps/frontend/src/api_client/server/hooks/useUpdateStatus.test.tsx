/**
 * #2311: the Admin card and the sidebar dot read one update notice. Only an admin asks for it,
 * Skip this release takes it off both at once until a newer release comes, and closing the card
 * does the same for a week.
 */
import { serverKeys, type UpdateStatus } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useSkipReleaseMutation, useSnoozeUpdateNoticeMutation, useUpdateNotice } from "./useUpdateStatus";

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
  post: vi.fn<(endpoint: string, body: unknown) => Promise<unknown>>(),
}));

vi.mock("../../api", () => ({ apiClient: { get: stubs.get, post: stubs.post } }));

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    enabled: true,
    locked: false,
    status: "available",
    current: "1.4.0",
    latest: "1.5.0",
    update_available: true,
    notice: true,
    release_url: "https://github.com/LibrePhotos/librephotos/releases/tag/1.5.0",
    published_at: "2026-11-14T10:00:00Z",
    checked_at: "2026-11-15T06:12:00Z",
    error: null,
    install_type: "docker",
    how_to_update_url: "https://docs.librephotos.com/docs/installation/upgrading",
    skipped_release: null,
    snoozed_until: null,
    ...overrides,
  };
}

let root: Root | undefined;
let queryClient: QueryClient;
let notice: UpdateStatus | null | undefined;
let skip: ((version: string) => Promise<UpdateStatus>) | undefined;
let snooze: (() => Promise<UpdateStatus>) | undefined;

function Harness({ isAdmin }: { isAdmin: boolean }) {
  notice = useUpdateNotice(isAdmin);
  skip = useSkipReleaseMutation().mutateAsync;
  snooze = useSnoozeUpdateNoticeMutation().mutateAsync;
  return null;
}

async function render(isAdmin: boolean) {
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <Harness isAdmin={isAdmin} />
      </QueryClientProvider>
    );
  });
  await settle();
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  notice = undefined;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  stubs.get.mockResolvedValue(status());
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  queryClient.clear();
  vi.useRealTimers();
});

describe("useUpdateNotice", () => {
  it("tells an admin about a newer release", async () => {
    await render(true);
    expect(stubs.get).toHaveBeenCalledWith("/updates/");
    expect(notice?.latest).toBe("1.5.0");
  });

  it("asks nothing for anyone else", async () => {
    await render(false);
    expect(stubs.get).not.toHaveBeenCalled();
    expect(notice).toBeNull();
  });

  it("has nothing to say while the server shows no notice", async () => {
    stubs.get.mockResolvedValue(status({ status: "up_to_date", notice: false, update_available: false }));
    await render(true);
    expect(notice).toBeNull();
  });

  it("Skip this release hides it at once, until a newer release comes", async () => {
    await render(true);
    stubs.post.mockResolvedValue(status({ status: "skipped", notice: false, skipped_release: "1.5.0" }));

    await act(async () => {
      await skip?.("1.5.0");
    });
    await settle();
    expect(stubs.post).toHaveBeenCalledWith("/updates/skip/", { version: "1.5.0" });
    expect(notice).toBeNull();

    // The next daily check found 1.6.0: the server shows the notice again.
    stubs.get.mockResolvedValue(status({ latest: "1.6.0", skipped_release: "1.5.0" }));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: serverKeys.updates() });
    });
    await settle();
    expect(notice?.latest).toBe("1.6.0");
  });

  it("closing the card hides it", async () => {
    await render(true);
    stubs.post.mockResolvedValue(status({ notice: false, snoozed_until: "2026-11-22T10:00:00Z" }));
    await act(async () => {
      await snooze?.();
    });
    await settle();
    expect(stubs.post).toHaveBeenCalledWith("/updates/snooze/", {});
    expect(notice).toBeNull();
  });
});
