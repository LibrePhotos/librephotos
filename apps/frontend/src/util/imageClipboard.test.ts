/**
 * Copying an image is only observable through the clipboard, so these tests
 * stand in the browser APIs and watch what reaches `navigator.clipboard.write`.
 *
 * The Safari case is the one worth pinning: the write has to be issued
 * synchronously, before the image has even been fetched, or Safari rejects it
 * as coming from outside a user gesture. A version that awaited the fetch
 * first would pass every other test here and fail on every Mac.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canCopyImagesToClipboard, copyImageToClipboard } from "./imageClipboard";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A ClipboardItem that keeps what it was given, so the test can inspect it. */
class FakeClipboardItem {
  constructor(public readonly data: Record<string, Blob | Promise<Blob>>) {}
}

const stubs = vi.hoisted(() => ({
  write: vi.fn(),
  toBlob: vi.fn(),
  drawImage: vi.fn(),
  close: vi.fn(),
}));

function setSecureContext(value: boolean | undefined) {
  Object.defineProperty(window, "isSecureContext", { value, configurable: true });
}

describe("canCopyImagesToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setSecureContext(undefined);
  });

  it("needs a secure context, ClipboardItem and clipboard.write", () => {
    setSecureContext(true);
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    vi.stubGlobal("navigator", { clipboard: { write: stubs.write } });
    expect(canCopyImagesToClipboard()).toBe(true);
  });

  it("is false over plain HTTP, where the browser exposes no clipboard", () => {
    setSecureContext(false);
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    vi.stubGlobal("navigator", { clipboard: { write: stubs.write } });
    expect(canCopyImagesToClipboard()).toBe(false);
  });

  it("is false without ClipboardItem or without clipboard.write", () => {
    setSecureContext(true);
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", { clipboard: { write: stubs.write } });
    expect(canCopyImagesToClipboard()).toBe(false);

    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    vi.stubGlobal("navigator", { clipboard: { writeText: () => {} } });
    expect(canCopyImagesToClipboard()).toBe(false);
  });
});

describe("copyImageToClipboard", () => {
  const webp = new Blob(["webp-bytes"], { type: "image/webp" });
  const png = new Blob(["png-bytes"], { type: "image/png" });
  let fetchDeferred: Deferred<Response>;

  beforeEach(() => {
    stubs.write.mockReset();
    stubs.toBlob.mockReset();
    stubs.drawImage.mockReset();
    stubs.close.mockReset();

    fetchDeferred = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => fetchDeferred.promise)
    );
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    // Browsers resolve the promises inside a ClipboardItem before the write
    // settles, and reject the write if any of them reject.
    stubs.write.mockImplementation(async (items: FakeClipboardItem[]) => {
      await Promise.all(items.flatMap(item => Object.values(item.data)));
    });
    vi.stubGlobal("navigator", { clipboard: { write: stubs.write } });
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 4, height: 3, close: stubs.close }))
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: stubs.drawImage,
    } as unknown as CanvasRenderingContext2D);
    stubs.toBlob.mockImplementation((callback: BlobCallback) => callback(png));
    HTMLCanvasElement.prototype.toBlob = stubs.toBlob;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function respondWith(blob: Blob, ok = true, status = 200) {
    fetchDeferred.resolve({ ok, status, blob: async () => blob } as unknown as Response);
  }

  it("hands the clipboard a promise before the image has arrived (Safari keeps the gesture)", async () => {
    const pending = copyImageToClipboard("/media/thumbnails_big/abc");

    // Nothing has been fetched yet, and the write is already issued.
    expect(stubs.write).toHaveBeenCalledTimes(1);
    const [item] = stubs.write.mock.calls[0][0] as FakeClipboardItem[];
    expect(item.data["image/png"]).toBeInstanceOf(Promise);

    respondWith(webp);
    await pending;
    await expect(item.data["image/png"]).resolves.toBe(png);
  });

  it("fetches with credentials so the media endpoint sees the session cookie", () => {
    copyImageToClipboard("/media/thumbnails_big/abc");
    expect(fetch).toHaveBeenCalledWith("/media/thumbnails_big/abc", { credentials: "include" });
  });

  it("re-encodes WebP through a canvas as PNG and releases the bitmap", async () => {
    const pending = copyImageToClipboard("/media/thumbnails_big/abc");
    respondWith(webp);
    await pending;

    expect(createImageBitmap).toHaveBeenCalledWith(webp);
    expect(stubs.drawImage).toHaveBeenCalledTimes(1);
    expect(stubs.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
    expect(stubs.close).toHaveBeenCalledTimes(1);
  });

  it("passes a PNG through untouched", async () => {
    const pending = copyImageToClipboard("/media/thumbnails_big/abc");
    respondWith(png);
    await pending;

    expect(createImageBitmap).not.toHaveBeenCalled();
    const [item] = stubs.write.mock.calls[0][0] as FakeClipboardItem[];
    await expect(item.data["image/png"]).resolves.toBe(png);
  });

  it("rejects when the image cannot be fetched", async () => {
    const pending = copyImageToClipboard("/media/thumbnails_big/missing");
    respondWith(webp, false, 404);
    await expect(pending).rejects.toThrow("HTTP 404");
  });

  it("rejects when the canvas produces no PNG", async () => {
    stubs.toBlob.mockImplementation((callback: BlobCallback) => callback(null));
    const pending = copyImageToClipboard("/media/thumbnails_big/abc");
    respondWith(webp);
    await expect(pending).rejects.toThrow("PNG encoding failed");
    expect(stubs.close).toHaveBeenCalledTimes(1);
  });

  it("surfaces the clipboard's own refusal", async () => {
    stubs.write.mockRejectedValue(new DOMException("Write permission denied.", "NotAllowedError"));
    await expect(copyImageToClipboard("/media/thumbnails_big/abc")).rejects.toThrow("Write permission denied.");
  });
});
