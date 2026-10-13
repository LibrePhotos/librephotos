/**
 * "Remove Missing Photos" in the Ctrl+K palette drops photo records for good, so it
 * goes through a confirmation: only Confirm starts the job, Cancel leaves it alone.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { ConfirmDeleteMissingPhotosModal } from "./Spotlight";

const stubs = vi.hoisted(() => ({
  mutate: vi.fn<(variables: undefined, options: { onSuccess: () => void }) => void>(),
  toast: vi.fn<() => void>(),
  countStats: { num_missing_photos: 4812 } as { num_missing_photos: number } | undefined,
}));

vi.mock("../../api_client/photos/hooks", () => ({
  useDeleteMissingPhotosMutation: () => ({ mutate: stubs.mutate }),
}));
vi.mock("../../api_client/stats/hooks", () => ({ useFetchCountStatsQuery: () => ({ data: stubs.countStats }) }));
vi.mock("../../service/notifications", () => ({ notification: { deleteMissingPhotos: stubs.toast } }));
// The palette's actions pull in the whole API client; only the modal is under test
vi.mock("./useSpotlightActions", () => ({ useSpotlightActions: () => ({}) }));

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const onClose = vi.fn<() => void>();

beforeAll(async () => {
  // jsdom has no matchMedia, MantineProvider needs it
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

const render = async () => {
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the dialog renders in place
      <MantineProvider env="test">
        <ConfirmDeleteMissingPhotosModal opened onClose={onClose} />
      </MantineProvider>
    );
  });
};

beforeEach(async () => {
  vi.clearAllMocks();
  stubs.countStats = { num_missing_photos: 4812 };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const button = (label: string) => {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    el => el.textContent === label
  );
  if (!found) throw new Error(`the ${label} button is not rendered`);
  return found;
};

describe("ConfirmDeleteMissingPhotosModal", () => {
  it("says how many photos it deletes", () => {
    expect(container.textContent).toContain(i18n.t("settings.missingphotosconfirmcount", { count: 4812 }));
    expect(container.textContent).toContain("4812 missing photos");
  });

  it("explains what the job does while the count is loading", async () => {
    stubs.countStats = undefined;
    await render();

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
