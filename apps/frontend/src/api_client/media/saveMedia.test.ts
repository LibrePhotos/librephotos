/** Saving a media file: the name the app chose, with the extension of the bytes the server sent. */
import { afterEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ fetchMedia: vi.fn<(url: string) => Promise<Response>>() }));
vi.mock("./mediaUrl", () => ({ fetchMedia: stubs.fetchMedia }));

const { saveMediaFile, savedFileName } = await import("./saveMedia");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("savedFileName", () => {
  it("keeps a name whose extension fits the bytes", () => {
    expect(savedFileName("IMG_1.JPG", "image/jpeg")).toBe("IMG_1.JPG");
    expect(savedFileName("beach-edited.jpg", "image/jpeg; charset=binary")).toBe("beach-edited.jpg");
    expect(savedFileName("IMG_1.CR2", "image/x-dcraw")).toBe("IMG_1.CR2");
    expect(savedFileName("photos.zip", "application/x-zip-compressed")).toBe("photos.zip");
  });

  it("gives JPEG bytes a JPEG name: an edited photo under its RAW's name, or a hash", () => {
    expect(savedFileName("IMG_1.CR2", "image/jpeg")).toBe("IMG_1.jpg");
    expect(savedFileName("3f2a9c0d1e", "image/jpeg")).toBe("3f2a9c0d1e.jpg");
    expect(savedFileName("trip.2024 final", "image/jpeg")).toBe("trip.2024 final.jpg");
  });

  it("leaves the name alone without a type it knows", () => {
    expect(savedFileName("3f2a9c0d1e", null)).toBe("3f2a9c0d1e");
    expect(savedFileName("3f2a9c0d1e", "application/octet-stream")).toBe("3f2a9c0d1e");
  });
});

describe("saveMediaFile", () => {
  it("saves under the chosen name, its extension following the answer's type", async () => {
    stubs.fetchMedia.mockResolvedValue(new Response(new Blob(["x"]), { headers: { "Content-Type": "image/jpeg" } }));
    URL.createObjectURL = () => "blob:file";
    URL.revokeObjectURL = () => {};
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    await saveMediaFile("/media/photos/abc", "IMG_1.CR2");
    expect(names).toEqual(["IMG_1.jpg"]);
  });
});
