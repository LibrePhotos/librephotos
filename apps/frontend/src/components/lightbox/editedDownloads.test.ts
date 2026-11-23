import { describe, expect, it } from "vitest";
import { editedDownloads, editedFileName, originalFileName, originalFileUrl } from "./editedDownloads";

const photo = (path: string, edit: Parameters<typeof editedDownloads>[0]["edit"] = null) => ({
  image_path: [path],
  image_hash: "abc123",
  edit,
});

describe("editedDownloads", () => {
  it("names the original by its file and the edited copy after it, as a JPEG", () => {
    expect(originalFileName(photo("/photos/2024/Beach Day.HEIC"))).toBe("Beach Day.HEIC");
    expect(editedFileName(photo("C:\\photos\\niaz.jpg"))).toBe("niaz-edited.jpg");
    expect(editedFileName(photo("/photos/.hidden"))).toBe(".hidden-edited.jpg");
    expect(originalFileName({ image_path: [], image_hash: "abc123" })).toBe("abc123");
  });

  it("offers nothing extra for a photo without an edit", () => {
    expect(editedDownloads(photo("/p/a.jpg"))).toBeNull();
    expect(editedDownloads(photo("/p/a.jpg", { version: 2, rendition: "none", width: 1, height: 1 }))).toBeNull();
  });

  it("offers both files of a photo whose rendition is ready", () => {
    const downloads = editedDownloads(photo("/p/a.png", { version: 4, rendition: "ready", width: 10, height: 10 }));
    expect(downloads?.original).toEqual({ url: originalFileUrl("abc123"), name: "a.png" });
    expect(downloads?.original.url).toMatch(/\/media\/photos\/abc123\?original=1$/);
    const edited = downloads?.edited;
    expect(edited?.kind).toBe("ready");
    if (edited?.kind !== "ready") return;
    expect(edited.url).toMatch(/\/media\/photos\/abc123\?v=4$/);
    expect(edited.name).toBe("a-edited.jpg");
  });

  it("holds the edited download back while the rendition is pending or failed", () => {
    expect(
      editedDownloads(photo("/p/a.jpg", { version: 1, rendition: "pending", width: 1, height: 1 }))?.edited
    ).toEqual({
      kind: "pending",
    });
    expect(
      editedDownloads(photo("/p/a.jpg", { version: 1, rendition: "failed", width: 1, height: 1 }))?.edited
    ).toEqual({
      kind: "failed",
    });
  });
});
