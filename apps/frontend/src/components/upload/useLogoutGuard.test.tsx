import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { LogoutWhileUploadingModal } from "./LogoutWhileUploadingModal";
import { useLogoutGuard } from "./useLogoutGuard";
import type { UploadItem, UploadQueue } from "./useUploadQueue";

const stubs = vi.hoisted(() => ({
  queue: null as UploadQueue | null,
  logout: vi.fn<() => void>(),
  cancel: vi.fn<() => void>(),
}));

vi.mock("./UploadContext", () => ({ useOptionalUpload: () => stubs.queue }));

let nextId = 0;
const item = (status: UploadItem["status"]): UploadItem => {
  nextId += 1;
  return { id: `item-${nextId}`, file: new File([], `${status}.jpg`), status, progress: 0 };
};

const queue = (isUploading: boolean, items: UploadItem[]): UploadQueue => ({
  items,
  isUploading,
  isCancelling: false,
  start: vi.fn<UploadQueue["start"]>(),
  retry: vi.fn<UploadQueue["retry"]>(),
  cancel: stubs.cancel,
  reset: vi.fn<UploadQueue["reset"]>(),
});

let requestLogout = () => {};
function Harness() {
  const guard = useLogoutGuard(stubs.logout);
  requestLogout = guard.requestLogout;
  return <LogoutWhileUploadingModal {...guard.modalProps} />;
}

let root: Root;
let container: HTMLDivElement;

const render = async () => {
  await act(async () => {
    root.render(
      // env="test" renders the modal without transitions.
      <MantineProvider env="test">
        <Harness />
      </MantineProvider>
    );
  });
};

const button = (label: string) =>
  defined(Array.from(document.querySelectorAll("button")).find(b => b.textContent === label));
const click = (el: HTMLElement) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
const dialogText = () => document.querySelector('[role="dialog"]')?.textContent ?? null;

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

describe("useLogoutGuard", () => {
  it("logs out straight away outside the protected shell", async () => {
    stubs.queue = null;
    await render();
    await act(async () => requestLogout());
    expect(stubs.logout).toHaveBeenCalledTimes(1);
    expect(dialogText()).toBeNull();
  });

  it("logs out straight away when no upload runs", async () => {
    stubs.queue = queue(false, [item("done")]);
    await render();
    await act(async () => requestLogout());
    expect(stubs.logout).toHaveBeenCalledTimes(1);
  });

  it("asks first while uploading; keep uploading closes the dialog without logging out", async () => {
    stubs.queue = queue(true, [item("done"), item("uploading"), item("pending"), item("pending")]);
    await render();
    await act(async () => requestLogout());

    expect(stubs.logout).not.toHaveBeenCalled();
    expect(dialogText()).toContain("Log out while uploading?");
    expect(dialogText()).toContain("3 files have not been uploaded yet");

    await click(button("Keep uploading"));
    expect(dialogText()).toBeNull();
    expect(stubs.logout).not.toHaveBeenCalled();
    expect(stubs.cancel).not.toHaveBeenCalled();
  });

  it("stops the upload and logs out on confirm", async () => {
    stubs.queue = queue(true, [item("uploading")]);
    await render();
    await act(async () => requestLogout());
    expect(dialogText()).toContain("1 file has not been uploaded yet");

    await click(button("Stop and log out"));
    expect(stubs.cancel).toHaveBeenCalledTimes(1);
    expect(stubs.logout).toHaveBeenCalledTimes(1);
  });
});
