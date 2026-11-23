import React from "react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { DEFAULT_WALL_DISPLAY_SETTINGS, type WallDisplaySettings } from "./wallDisplay";
import { WallDisplayModal } from "./WallDisplayModal";

const FINE_POINTER = "(hover: hover) and (pointer: fine)";

function pointer(fine: boolean) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: fine && query === FINE_POINTER,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

async function renderModal(settings: Partial<WallDisplaySettings> = {}) {
  await renderInMantine(
    <WallDisplayModal
      opened
      onClose={() => {}}
      settings={{ ...DEFAULT_WALL_DISPLAY_SETTINGS, ...settings }}
      onChange={() => {}}
    />
  );
  return defined(openDialog());
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  pointer(true);
});

describe("WallDisplayModal", () => {
  it("offers Hide the cursor only where there is a mouse", async () => {
    expect((await renderModal()).textContent).toContain("Hide the cursor");

    document.body.innerHTML = "";
    pointer(false);
    const dialog = await renderModal();
    expect(dialog.textContent).not.toContain("Hide the cursor");
    expect(dialog.textContent).toContain("Burn-in protection");
  });

  it("indents the sleep times under their switch and warns when they are the same", async () => {
    const dialog = await renderModal({ sleepEnabled: true, sleepStart: "07:00", sleepEnd: "07:00" });
    const times = defined(
      [...dialog.querySelectorAll<HTMLElement>(".mantine-Stack-root")].find(stack =>
        stack.textContent?.startsWith("Sleep from")
      )
    );
    const warning = defined(
      [...dialog.querySelectorAll<HTMLElement>("p")].find(text =>
        text.textContent?.startsWith("The two times are the same")
      )
    );

    expect(times.getAttribute("style") ?? "").toContain(`calc(${58 / 16}rem`);
    expect(warning.getAttribute("style") ?? "").toContain("orange");
  });
});
