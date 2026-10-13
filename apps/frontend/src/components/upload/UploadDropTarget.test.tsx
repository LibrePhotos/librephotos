import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Dropzone from "react-dropzone";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { UploadDropTarget } from "./UploadDropTarget";
import type { UploadAvailability } from "./useCanUpload";
import type { UploadQueue } from "./useUploadQueue";

const stubs = vi.hoisted(() => ({
  availability: "ready" as UploadAvailability,
  isUploading: false,
  start: vi.fn<(files: File[]) => void>(),
  avatarDrop: vi.fn<(files: File[]) => void>(),
}));

vi.mock("./useCanUpload", () => ({ useCanUpload: () => stubs.availability }));
vi.mock("./UploadContext", () => ({
  useUpload: (): Pick<UploadQueue, "start" | "isUploading"> => ({ start: stubs.start, isUploading: stubs.isUploading }),
}));

let root: Root;
let container: HTMLDivElement;

const render = async (children: React.ReactNode = <div data-testid="page">page</div>) => {
  await act(async () => {
    root.render(
      <MantineProvider>
        <UploadDropTarget>{children}</UploadDropTarget>
      </MantineProvider>
    );
  });
};

const image = (name: string, type = "image/jpeg") => new File([new Uint8Array(4)], name, { type });

/** A drag event as a browser sends it for files from the desktop. */
const fire = async (type: "dragenter" | "dragover" | "dragleave" | "drop", target: Element, files: File[]) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files,
      types: ["Files"],
      items: files.map(file => ({ kind: "file", type: file.type, getAsFile: () => file })),
    },
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  // react-dropzone reads the files asynchronously.
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  return event;
};

const page = () => defined(container.querySelector('[data-testid="page"]'));
const overlay = () => container.querySelector<HTMLElement>('[data-testid="upload-drop-overlay"]');

beforeAll(async () => {
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
  stubs.availability = "ready";
  stubs.isUploading = false;
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

describe("UploadDropTarget", () => {
  it("uploads every photo dropped anywhere on the shell", async () => {
    await render();
    const files = [image("a.jpg"), image("b.png", "image/png")];

    const drop = await fire("drop", page(), files);

    expect(stubs.start).toHaveBeenCalledWith(files);
    expect(drop.defaultPrevented).toBe(true);
  });

  it("takes HEIC and RAW files whose type the browser left empty, and skips other files", async () => {
    await render();
    const heic = image("IMG_0001.HEIC", "");
    const raw = image("DSC04211.ARW", "");

    await fire("drop", page(), [heic, raw, image("notes.pdf", "application/pdf")]);

    expect(stubs.start).toHaveBeenCalledWith([heic, raw]);
  });

  it("shows the overlay while files are dragged over the window and hides it on leave and drop", async () => {
    await render();
    const files = [image("a.jpg")];

    await fire("dragenter", page(), files);
    expect(defined(overlay()).textContent).toContain("Drop photos and videos to upload");
    expect(overlay()?.dataset.tone).toBe("blue");

    await fire("dragleave", page(), files);
    expect(overlay()).toBeNull();

    await fire("dragenter", page(), files);
    await fire("drop", page(), files);
    expect(overlay()).toBeNull();
  });

  it("warns about files that are not photos or videos", async () => {
    await render();
    await fire("dragenter", page(), [image("notes.pdf", "application/pdf")]);
    expect(defined(overlay()).textContent).toContain("Only photos and videos can be uploaded");
    expect(overlay()?.dataset.tone).toBe("red");
  });

  it("says a drop joins the running upload", async () => {
    stubs.isUploading = true;
    await render();
    await fire("dragenter", page(), [image("a.jpg")]);
    expect(defined(overlay()).textContent).toContain("Add to the running upload");
  });

  it("explains a missing scan directory and ignores the drop", async () => {
    stubs.availability = "no_scan_directory";
    await render();

    await fire("dragenter", page(), [image("a.jpg")]);
    expect(defined(overlay()).textContent).toContain("Uploading is not set up yet");
    expect(overlay()?.dataset.tone).toBe("gray");

    await fire("drop", page(), [image("a.jpg")]);
    expect(stubs.start).not.toHaveBeenCalled();
  });

  it("does nothing with uploads turned off, but still keeps the file from opening in the tab", async () => {
    stubs.availability = "off";
    await render();

    await fire("dragenter", page(), [image("a.jpg")]);
    expect(overlay()).toBeNull();
    const drop = await fire("drop", page(), [image("a.jpg")]);

    expect(stubs.start).not.toHaveBeenCalled();
    expect(drop.defaultPrevented).toBe(true);
  });

  it("ignores a drag that started on the page, such as a thumbnail", async () => {
    await render();
    await act(async () => {
      page().dispatchEvent(new Event("dragstart", { bubbles: true }));
    });

    await fire("dragenter", page(), [image("thumbnail.jpg")]);
    expect(overlay()).toBeNull();
    await fire("drop", page(), [image("thumbnail.jpg")]);
    expect(stubs.start).not.toHaveBeenCalled();

    await act(async () => {
      page().dispatchEvent(new Event("dragend", { bubbles: true }));
    });
    await fire("drop", page(), [image("a.jpg")]);
    expect(stubs.start).toHaveBeenCalledTimes(1);
  });

  it("leaves a nested drop zone that stops bubbling (the avatar) alone", async () => {
    await render(
      <Dropzone noClick noDragEventsBubbling onDrop={stubs.avatarDrop}>
        {({ getRootProps, getInputProps }) => (
          <div {...getRootProps()} data-testid="avatar">
            <input {...getInputProps()} />
          </div>
        )}
      </Dropzone>
    );
    const avatar = defined(container.querySelector('[data-testid="avatar"]'));
    const files = [image("me.jpg")];

    await fire("dragenter", avatar, files);
    expect(overlay()).toBeNull();
    await fire("drop", avatar, files);

    expect(stubs.avatarDrop).toHaveBeenCalledTimes(1);
    expect(stubs.start).not.toHaveBeenCalled();
  });
});
