import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import { NO_OUTCOMES } from "./uploadProcessing";
import { UploadProgressCard } from "./UploadProgressCard";
import type { UploadProcessing } from "./useUploadProcessing";
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
  return { queue, processing: null as UploadProcessing | null };
});

vi.mock("./UploadContext", () => ({
  useUpload: () => stubs.queue,
  useOptionalUploadProcessing: () => stubs.processing,
}));
// The album strip's "Open album" and the rows' "Open My Jobs" links, without a router
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, params, ...props }: { to: string; params?: { id: string } } & React.ComponentProps<"a">) => (
    <a {...props} href={params ? to.replace("$id", params.id) : to} />
  ),
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
  stubs.processing = null;
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
    const cancel = defined(byTestId("upload-cancel"));
    expectDisabledWithReason(cancel, "Stopping…");
    await click(cancel);
    expect(stubs.queue.cancel).not.toHaveBeenCalled();
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

  describe("into an album (#612)", () => {
    const porto = { id: 12, title: "Porto 2025" };
    const inPorto = (it: UploadItem, albumOutcome?: UploadItem["albumOutcome"]): UploadItem => ({
      ...it,
      album: porto,
      albumOutcome,
    });
    const strip = () => byTestId("upload-album-strip");

    it("names the album while uploading", async () => {
      await render([inPorto(item("a.jpg", "uploading", 50)), inPorto(item("b.jpg", "pending"))], true);
      expect(defined(strip()).textContent).toBe("Adding to Porto 2025");
    });

    it("counts the files that landed in the album and links to it", async () => {
      await render(
        [
          inPorto(item("a.jpg", "done", 100)),
          inPorto(item("b.jpg", "duplicate", 100), "added_existing"),
          inPorto(item("c.jpg", "done", 100), "library_only"),
          inPorto(item("d.jpg", "error", 0, "Boom")),
        ],
        false
      );

      expect(defined(strip()).textContent).toContain("2 files added to Porto 2025");
      expect(defined(strip()).querySelector("a")?.getAttribute("href")).toBe("/album/user/12");
      const card = defined(byTestId("upload-progress-card"));
      expect(card.textContent).toContain("Already in your library: added to the album");
      expect(card.textContent).toContain("Added to your library only: the album is locked or was deleted");
    });

    it("offers no link when nothing reached the album", async () => {
      await render([inPorto(item("a.jpg", "error", 0, "Boom"))], false);
      expect(defined(strip()).querySelector("a")).toBeNull();
    });

    it("has no album line for an upload into the library, or into several albums", async () => {
      await render([item("a.jpg", "done", 100)], false);
      expect(strip()).toBeNull();

      await render(
        [inPorto(item("a.jpg", "done", 100)), { ...item("b.jpg", "done", 100), album: { id: 13, title: "Lisbon" } }],
        false
      );
      expect(strip()).toBeNull();
    });
  });

  describe("after the upload, while the server imports the files (#2739)", () => {
    const uploaded = (name: string, photoId: string): UploadItem => ({
      ...item(name, "done", 100),
      jobId: "job-1",
      photoId,
    });
    const files = [uploaded("a.jpg", "p1"), uploaded("b.jpg", "p2"), uploaded("c.jpg", "p3")];
    const following = (patch: Partial<UploadProcessing>): UploadProcessing => ({
      phase: "processing",
      outcomes: NO_OUTCOMES,
      counts: { ready: 0, total: 3 },
      stalledMinutes: null,
      openImports: [],
      ...patch,
    });
    const rows = () => [...container.querySelectorAll<HTMLElement>('[data-testid="upload-row"]')];

    it("counts the ready uploads and shows each file's state, with the server's thumbnail once ready", async () => {
      stubs.processing = following({
        counts: { ready: 1, total: 3 },
        outcomes: { ...NO_OUTCOMES, ready: new Set(["p1"]) },
      });
      await render(files, false);

      const card = defined(byTestId("upload-progress-card"));
      expect(card.textContent).toContain("Processing your uploads");
      expect(card.textContent).toContain("1/3 ready");
      expect(rows().map(row => row.textContent)).toEqual(["a.jpgReady", "b.jpgProcessing", "c.jpgProcessing"]);
      expect(defined(rows()[0]).querySelector("img")?.getAttribute("src")).toBe("/media/square_thumbnails_small/p1");
      // Closing is allowed: the account menu keeps following the import.
      expect(byTestId("upload-close")).not.toBeNull();
    });

    it("puts a failure on the file's own row", async () => {
      const failure = (photo_id: string, stage: string, error: string) => ({ photo_id, file: "x", stage, error });
      stubs.processing = following({
        outcomes: {
          ready: new Set(["p3"]),
          failed: new Map([
            ["p1", failure("p1", "media", "unsupported RAW format")],
            ["p3", failure("p3", "faces", "the face service is down")],
          ]),
          lost: new Set(["p2"]),
        },
      });
      await render(files, false);

      const [first, second, third] = rows().map(row => row.textContent);
      expect(first).toContain("Not imported");
      expect(first).toContain("Uploaded, but the server could not read it: unsupported RAW format");
      expect(defined(rows()[0]).querySelector("a")?.getAttribute("href")).toBe("/jobs");
      expect(second).toContain("the server stopped before processing it");
      expect(third).toContain("Ready");
      expect(third).toContain("In your library, but finding faces failed: the face service is down");
    });

    it("says when the server makes no progress", async () => {
      stubs.processing = following({ stalledMinutes: 4 });
      await render(files, false);

      expect(defined(byTestId("upload-stalled")).textContent).toContain("No progress for 4 minutes");
    });

    it("updates search and faces once every file is processed", async () => {
      stubs.processing = following({ phase: "followups", counts: { ready: 3, total: 3 } });
      await render(files, false);

      const card = defined(byTestId("upload-progress-card"));
      expect(card.textContent).toContain("Updating search and faces");
      expect(card.textContent).toContain("3/3 ready · already in your timeline");
    });

    it("ends with the photos ready", async () => {
      stubs.processing = following({ phase: "done", counts: { ready: 3, total: 3 } });
      await render([...files, item("d.jpg", "duplicate", 100)], false);

      const card = defined(byTestId("upload-progress-card"));
      expect(card.textContent).toContain("3 photos ready");
      expect(card.textContent).toContain("3 uploaded · 1 duplicate");
    });

    it("keeps the upload's own title while files are still being sent", async () => {
      stubs.processing = following({});
      await render([...files, item("d.jpg", "uploading", 40)], true);

      expect(defined(byTestId("upload-progress-card")).textContent).toContain("Uploading…");
    });
  });
});
