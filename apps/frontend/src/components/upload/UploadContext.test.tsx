import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadProvider } from "./UploadContext";

const stubs = vi.hoisted(() => ({ isUploading: false }));

vi.mock("./useUploadQueue", () => ({
  useUploadQueue: () => ({ items: [], isUploading: stubs.isUploading }),
}));
// The server side polls the API; these tests are about the queue's provider.
vi.mock("./useUploadProcessing", () => ({ useUploadProcessing: () => null }));

let root: Root;
let container: HTMLDivElement;

const render = async (isUploading: boolean) => {
  stubs.isUploading = isUploading;
  await act(async () => {
    root.render(
      <UploadProvider>
        <div />
      </UploadProvider>
    );
  });
};

/** Dispatches what the browser fires on close or reload; true when the page asked to stay. */
const leavePage = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
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

describe("UploadProvider", () => {
  it("asks before the tab closes while an upload runs, and not once it drained", async () => {
    await render(true);
    expect(leavePage()).toBe(true);

    await render(false);
    expect(leavePage()).toBe(false);
  });

  it("stops asking when the provider unmounts (logout)", async () => {
    await render(true);
    await act(async () => {
      root.unmount();
    });
    expect(leavePage()).toBe(false);
    root = createRoot(container);
  });
});
