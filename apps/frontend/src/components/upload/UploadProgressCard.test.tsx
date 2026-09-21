import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { UploadProgressCard } from "./UploadProgressCard";
import type { UploadItem, UploadQueue } from "./useUploadQueue";

const stubs = vi.hoisted(() => ({
  queue: {
    items: [] as UploadItem[],
    isUploading: false,
    start: vi.fn(),
    retry: vi.fn(),
    reset: vi.fn(),
  } as UploadQueue,
}));

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

const render = async (items: UploadItem[], isUploading: boolean) => {
  stubs.queue.items = items;
  stubs.queue.isUploading = isUploading;
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
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
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

  it("summarises a running upload and keeps the close button locked", async () => {
    await render([item("a.jpg", "done", 100), item("b.mp4", "uploading", 50), item("c.jpg", "error", 0, "Boom")], true);

    const card = byTestId("upload-progress-card")!;
    expect(card.textContent).toContain("Uploading…");
    expect(card.textContent).toContain("2/3 processed");
    expect(card.textContent).toContain("1 error");
    expect(card.textContent).toContain("Boom");
    expect(container.querySelectorAll('[data-testid="upload-row"]')).toHaveLength(3);
    expect(byTestId("upload-close")).toHaveProperty("disabled", true);
    expect(byTestId("upload-retry-all")).toBeNull();

    await click(byTestId("upload-close"));
    expect(stubs.queue.reset).not.toHaveBeenCalled();
  });

  it("offers retry-all once the queue is idle with failures, and can be dismissed", async () => {
    const items = [item("a.jpg", "done", 100), item("b.jpg", "error", 0, "Boom"), item("c.jpg", "error", 0, "Bang")];
    await render(items, false);

    const card = byTestId("upload-progress-card")!;
    expect(card.textContent).toContain("Upload complete");
    expect(card.textContent).toContain("3/3 processed");
    expect(card.textContent).toContain("2 errors");

    const retryAll = byTestId("upload-retry-all")!;
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
    expect(byTestId("upload-progress-card")!.textContent).toContain("2/2 processed");
    expect(byTestId("upload-progress-card")!.textContent).toContain("1 duplicate");
  });
});
