/**
 * Uploading into an album from its page (#612): the picker's files go into the album, the page
 * names the album for drops anywhere on it while it is mounted, and the album says why it takes
 * no uploads (locked, no scan directory). Uploads turned off, or someone else's album: nothing.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { UploadProvider, useDropAlbum, type DropAlbum } from "./UploadContext";
import { useAlbumUpload, type AlbumUpload, type UploadableAlbum } from "./useAlbumUpload";
import type { UploadAvailability } from "./useCanUpload";
import type { UploadQueue } from "./useUploadQueue";

const stubs = vi.hoisted(() => ({
  availability: "ready" as UploadAvailability,
  start: vi.fn<UploadQueue["start"]>(),
}));

vi.mock("./useCanUpload", () => ({ useCanUpload: () => stubs.availability }));
vi.mock("./useUploadQueue", () => ({
  useUploadQueue: () => ({ items: [], isUploading: false, start: stubs.start }),
}));

const porto: UploadableAlbum = { id: 12, title: "Porto 2025", locked: false };

let upload: AlbumUpload | null = null;
let dropAlbum: DropAlbum | null = null;

function AlbumPage({ album }: { album: UploadableAlbum | null }) {
  upload = useAlbumUpload(album);
  return upload ? <input {...upload.inputProps} data-testid="picker" /> : null;
}

function DropTargetProbe() {
  dropAlbum = useDropAlbum();
  return null;
}

let root: Root;
let container: HTMLDivElement;

const render = async (album: UploadableAlbum | null, showPage = true) => {
  await act(async () => {
    root.render(
      <UploadProvider>
        <DropTargetProbe />
        {showPage && <AlbumPage album={album} />}
      </UploadProvider>
    );
  });
};

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  vi.clearAllMocks();
  stubs.availability = "ready";
  upload = null;
  dropAlbum = null;
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

describe("useAlbumUpload", () => {
  it("uploads the chosen files into the album", async () => {
    await render(porto);
    expect(defined(upload).reason).toBeNull();
    const photo = new File([new Uint8Array(4)], "a.jpg", { type: "image/jpeg" });
    const input = defined(container.querySelector<HTMLInputElement>('[data-testid="picker"]'));

    Object.defineProperty(input, "files", { value: [photo] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(() => new Promise<void>(resolve => setTimeout(resolve, 0)));

    expect(stubs.start).toHaveBeenCalledWith([photo], { id: 12, title: "Porto 2025" });
  });

  it("names the album for drops while the page is open, and forgets it after", async () => {
    await render(porto);
    expect(dropAlbum).toEqual({ album: { id: 12, title: "Porto 2025" }, locked: false });

    await render(porto, false);
    expect(dropAlbum).toBeNull();
  });

  it("says a locked album takes no uploads, and still names it for the drop overlay", async () => {
    await render({ ...porto, locked: true });

    expect(defined(upload).reason).toBe("Porto 2025 is locked. Unlock it to add photos.");
    expect(dropAlbum).toEqual({ album: { id: 12, title: "Porto 2025" }, locked: true });
  });

  it("says why without a scan directory", async () => {
    stubs.availability = "no_scan_directory";
    await render(porto);

    expect(defined(upload).reason).toBe(i18n.t("toasts.scan_directory_required"));
  });

  it("offers nothing with uploads turned off", async () => {
    stubs.availability = "off";
    await render(porto);

    expect(upload).toBeNull();
  });

  it("offers nothing for an album that is not yours", async () => {
    await render(null);

    expect(upload).toBeNull();
    expect(dropAlbum).toBeNull();
  });
});
