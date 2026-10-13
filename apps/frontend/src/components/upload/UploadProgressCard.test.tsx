import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { UploadProgressCard } from "./UploadProgressCard";
import type { UploadItem, UploadQueue } from "./useUploadQueue";

const stubs = vi.hoisted(() => {
  const queue: UploadQueue = {
    items: [],
    isUploading: false,
    isCancelling: false,
    start: vi.fn<UploadQueue["start"]>(),
    retry: vi.fn<UploadQueue["retry"]>(),
    cancel: vi.fn<UploadQueue["cancel"]>(),
    reset: vi.fn<UploadQueue["reset"]>(),
  };
  return { queue };
});

vi.mock("./UploadContext", () => ({
  useUpload: () => stubs.queue,
}));

const item = (name: string, status: UploadItem["status"], progress = 0, error?: string): UploadItem => ({
  id: name,
  file: new File([new Uint8Array(100)], name, { type: name.endsWith(".mp4") ? "video/mp4" : "image/jpeg" }),
  status,
  progress,
  error,
});

let root: Root;
let container: HTMLDivElement;

const render = async (items: UploadItem[], isUploading: boolean, isCancelling = false) => {
  stubs.queue.items = items;
  stubs.queue.isUploading = isUploading;
  stubs.queue.isCancelling = isCancelling;
  await act(async () => {
    root.render(
      <MantineProvider>
        <UploadProgressCard />
      </MantineProvider>
    );
  });
};

const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: HTMLElement | null) =>
  act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

beforeAll(async () => {
  // jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("UploadProgressCard", () => {
  it("renders nothing while the queue is empty", async () => {
    await render([], false);
    expect(byTestId("upload-progress-card")).toBeNull();
  });

  it("summarises a running upload and offers Cancel instead of close", async () => {
    await render([item("a.jpg", "done", 100), item("b.mp4", "uploading", 50), item("c.jpg", "error", 0, "Boom")], true);

    const card = defined(byTestId("upload-progress-card"));
    expect(card.textContent).toContain("Uploading…");
    expect(card.textContent).toContain("2/3 processed");
    expect(card.textContent).toContain("1 error");
    expect(card.textContent).toContain("Boom");
    expect(container.querySelectorAll('[data-testid="upload-row"]')).toHaveLength(3);
    expect(byTestId("upload-close")).toBeNull();
    expect(byTestId("upload-retry-all")).toBeNull();

    const cancel = defined(byTestId("upload-cancel"));
    expect(cancel.textContent).toBe("Cancel");
    await click(cancel);
    expect(stubs.queue.cancel).toHaveBeenCalledTimes(1);
  });

  it("shows Stopping… with a locked Cancel until the file in flight returns", async () => {
    await render([item("a.jpg", "uploading", 50), item("b.jpg", "cancelled")], true, true);

    const card = defined(byTestId("upload-progress-card"));
    expect(card.textContent).toContain("Stopping…");
    expect(card.textContent).toContain("1 cancelled");
    expect(byTestId("upload-cancel")).toHaveProperty("disabled", true);
  });

  it("says the upload was cancelled and retries cancelled and failed files with one button", async () => {
    const items = [item("a.jpg", "done", 100), item("b.jpg", "error", 0, "Boom"), item("c.jpg", "cancelled")];
    await render(items, false);

    const card = defined(byTestId("upload-progress-card"));
    expect(card.textContent).toContain("Upload cancelled");
    expect(card.textContent).toContain("2/3 processed · 1 error · 1 cancelled");
    expect(card.textContent).toContain("Cancelled");
    expect(byTestId("upload-cancel")).toBeNull();

    const retryAll = defined(byTestId("upload-retry-all"));
    expect(retryAll.textContent).toContain("Retry 2 uploads");
    await click(retryAll);
    expect(stubs.queue.retry).toHaveBeenCalledWith(items);
  });

  it("names the cancelled files in the retry button when nothing failed", async () => {
    await render([item("a.jpg", "cancelled"), item("b.jpg", "cancelled")], false);
    expect(defined(byTestId("upload-retry-all")).textContent).toContain("Retry 2 cancelled uploads");
  });

  it("offers retry-all once the queue is idle with failures, and can be dismissed", async () => {
    const items = [item("a.jpg", "done", 100), item("b.jpg", "error", 0, "Boom"), item("c.jpg", "error", 0, "Bang")];
    await render(items, false);

    const card = defined(byTestId("upload-progress-card"));
    expect(card.textContent).toContain("Upload complete");
    expect(card.textContent).toContain("3/3 processed");
    expect(card.textContent).toContain("2 errors");

    const retryAll = defined(byTestId("upload-retry-all"));
    expect(retryAll.textContent).toContain("Retry 2 failed uploads");
    await click(retryAll);
    expect(stubs.queue.retry).toHaveBeenCalledWith(items);

    await click(byTestId("upload-close"));
    expect(stubs.queue.reset).toHaveBeenCalledTimes(1);
  });

  it("collapses the file list but keeps the summary", async () => {
    await render([item("a.jpg", "done", 100), item("b.jpg", "duplicate", 100)], false);
    expect(container.querySelectorAll('[data-testid="upload-row"]')).toHaveLength(2);

    await click(container.querySelector<HTMLElement>('[aria-label="Collapse list"]'));
    expect(container.querySelectorAll('[data-testid="upload-row"]')).toHaveLength(0);
    expect(defined(byTestId("upload-progress-card")).textContent).toContain("2/2 processed");
    expect(defined(byTestId("upload-progress-card")).textContent).toContain("1 duplicate");
  });
});
