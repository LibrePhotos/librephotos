/** "Copied" is said only when the text reached the clipboard: the browser may refuse the write. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./util";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubClipboard(writeText: (text: string) => Promise<void>) {
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
}

describe("copyText", () => {
  it("resolves true once the clipboard took the text", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    stubClipboard(writeText);
    await expect(copyText("https://photos.example/s/abc")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://photos.example/s/abc");
  });

  it("resolves false when the browser refuses the write", async () => {
    stubClipboard(async () => {
      throw new DOMException("Document is not focused.", "NotAllowedError");
    });
    await expect(copyText("text")).resolves.toBe(false);
  });
});
