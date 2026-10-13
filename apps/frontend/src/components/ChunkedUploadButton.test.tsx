import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { defined } from "../util/defined.test-utils";
import { ChunkedUploadButton } from "./ChunkedUploadButton";
import type { UploadAvailability } from "./upload/useCanUpload";
import type { UploadQueue } from "./upload/useUploadQueue";

const stubs = vi.hoisted(() => ({
  availability: "ready" as UploadAvailability,
  start: vi.fn<(files: File[]) => void>(),
}));

vi.mock("./upload/useCanUpload", () => ({ useCanUpload: () => stubs.availability }));
vi.mock("./upload", () => ({
  useUpload: (): Pick<UploadQueue, "start" | "isUploading"> => ({ start: stubs.start, isUploading: false }),
}));

let root: Root;
let container: HTMLDivElement;

const render = async (availability: UploadAvailability) => {
  stubs.availability = availability;
  await act(async () => {
    root.render(
      <MantineProvider>
        <ChunkedUploadButton />
      </MantineProvider>
    );
  });
};

const uploadButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="Upload photos and videos"]');
const input = () => defined(container.querySelector<HTMLInputElement>('[data-testid="upload-input"]'));

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

describe("ChunkedUploadButton", () => {
  it("opens the file picker and uploads the picked files", async () => {
    await render("ready");
    const pickerClick = vi.spyOn(input(), "click").mockImplementation(() => {});

    await act(async () => {
      defined(uploadButton()).click();
    });
    expect(pickerClick).toHaveBeenCalledTimes(1);

    const picked = [new File([new Uint8Array(4)], "a.jpg", { type: "image/jpeg" })];
    Object.defineProperty(input(), "files", { value: picked });
    await act(async () => {
      input().dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
    expect(stubs.start).toHaveBeenCalledWith(picked);
  });

  it("is disabled without a scan directory", async () => {
    await render("no_scan_directory");
    expect(uploadButton()).toHaveProperty("disabled", true);
  });

  it("is not shown when uploads are turned off", async () => {
    await render("off");
    expect(uploadButton()).toBeNull();
  });
});
