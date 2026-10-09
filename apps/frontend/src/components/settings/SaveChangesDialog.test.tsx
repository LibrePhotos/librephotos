/**
 * The "Save changes?" prompt of the Settings, Profile and Library pages.
 *
 * - On a phone it sat on top of the bottom navigation bar.
 * - Its close button only hid it on two of the three pages, which left the
 *   edits on screen with no way left to save them.
 * - During a save the close button still discarded the edits.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FOOTER_HEIGHT } from "../../ui-constants";
import { SaveChangesDialog } from "./SaveChangesDialog";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

let desktop = false;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Only the "sm and up" query of useMatches matters; a phone matches none of them.
  window.matchMedia = (query: string) =>
    ({
      matches: desktop && query.includes("min-width"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
});

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function render(props: Partial<React.ComponentProps<typeof SaveChangesDialog>> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <SaveChangesDialog opened onSave={onSave} onCancel={onCancel} {...props} />
      </MantineProvider>
    );
  });
  cleanup = async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  };
  const dialog = document.body.querySelector<HTMLElement>('[data-testid="save-changes-dialog"]')!;
  const button = (label: string) =>
    [...dialog.querySelectorAll("button")].find(b => b.textContent?.trim() === label) as HTMLButtonElement;
  return { dialog, button, onSave, onCancel };
}

/** The Affix around the dialog carries the position as CSS variables. */
function affixBottom(dialog: HTMLElement) {
  return dialog.parentElement?.closest<HTMLElement>(".mantine-Affix-root")?.style.getPropertyValue("--affix-bottom");
}

describe("SaveChangesDialog", () => {
  it("sits above the bottom navigation bar on a phone", async () => {
    desktop = false;
    const { dialog } = await render();

    // rem(66) with the default scale: 66 / 16 = 4.125rem.
    expect(affixBottom(dialog)).toContain(`${(FOOTER_HEIGHT + 16) / 16}rem`);
  });

  it("keeps Mantine's usual offset from the sm breakpoint up", async () => {
    desktop = true;
    const { dialog } = await render();

    expect(affixBottom(dialog)).toContain(`${30 / 16}rem`);
  });

  it("discards the edits from the close button as well as from Cancel", async () => {
    const { dialog, button, onCancel } = await render();

    await act(async () => {
      button("settings.nextcloudcancel").click();
    });
    await act(async () => {
      dialog.querySelector<HTMLButtonElement>(".mantine-Dialog-closeButton")!.click();
    });

    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("saves from Update", async () => {
    const { button, onSave } = await render();

    await act(async () => {
      button("settings.favoriteupdate").click();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("shows a save in progress and blocks Cancel meanwhile", async () => {
    const { button } = await render({ saving: true });

    expect(button("settings.favoriteupdate").dataset.loading).toBe("true");
    expect(button("settings.nextcloudcancel").disabled).toBe(true);
  });

  it("offers no close button while saving, so the edits cannot be discarded mid-save", async () => {
    const { dialog } = await render({ saving: true });

    expect(dialog.querySelector(".mantine-Dialog-closeButton")).toBeNull();
  });
});
