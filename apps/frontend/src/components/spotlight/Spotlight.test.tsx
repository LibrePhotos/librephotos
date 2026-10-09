/**
 * "Remove Missing Photos" in the Ctrl+K palette drops photo records for good, so it
 * goes through a confirmation: only Confirm starts the job, Cancel leaves it alone.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { ConfirmDeleteMissingPhotosModal } from "./Spotlight";

const stubs = vi.hoisted(() => ({ mutate: vi.fn(), toast: vi.fn() }));

vi.mock("../../api_client/photos/hooks", () => ({
  useDeleteMissingPhotosMutation: () => ({ mutate: stubs.mutate }),
}));
vi.mock("../../service/notifications", () => ({ notification: { deleteMissingPhotos: stubs.toast } }));
// The palette's actions pull in the whole API client; only the modal is under test
vi.mock("./useSpotlightActions", () => ({ useSpotlightActions: () => ({}) }));

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const onClose = vi.fn();

beforeAll(async () => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(async () => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the dialog renders in place
      <MantineProvider env="test">
        <ConfirmDeleteMissingPhotosModal opened onClose={onClose} />
      </MantineProvider>
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const button = (label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === label)!;

describe("ConfirmDeleteMissingPhotosModal", () => {
  it("explains what the job does", () => {
    expect(container.textContent).toContain(i18n.t("settings.missingphotosconfirm"));
  });

  it("starts the job on Confirm", async () => {
    await act(async () => button(i18n.t("confirm")).click());

    expect(stubs.mutate).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not start the job on Cancel", async () => {
    await act(async () => button(i18n.t("cancel")).click());

    expect(stubs.mutate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
