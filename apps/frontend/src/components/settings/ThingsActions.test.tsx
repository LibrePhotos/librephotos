/**
 * #2765: things were found only for photos that had none, after a scan, so a changed list of things
 * (custom words, a new release, another confidence) never reached the photos already labelled. The
 * Library page's Things section finds them in the photos without things, or, after asking, in every
 * photo again.
 */
import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import { click, dialogButton, openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { ThingsActions } from "./ThingsActions";

type MutateOptions = { onSettled?: () => void };

const stubs = vi.hoisted(() => ({
  find: vi.fn<(fullScan: boolean, options?: MutateOptions) => void>(),
}));

vi.mock("../../api_client/jobs/hooks", () => ({
  useFindThingsMutation: () => ({ mutate: stubs.find, isPending: false }),
}));

const BUSY = "A job is running.";
const AGAIN = "Find things again for all photos";

async function renderActions({ busyReason = undefined as string | undefined, available = true, isAdmin = true } = {}) {
  const { container } = await renderInMantine(
    <ThingsActions busyReason={busyReason} isAdmin={isAdmin} isThingsAvailable={available} />
  );
  const buttons = [...container.querySelectorAll("button")];
  return {
    container,
    find: defined(buttons.find(button => button.textContent?.trim() === "Find")),
    more: defined(container.querySelector<HTMLButtonElement>(`button[aria-label="${AGAIN}"]`)),
  };
}

/** The menu item `label`, once the dropdown has opened (its transition runs on a timer). */
async function menuItem(label: string): Promise<HTMLElement> {
  const lookUp = () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.trim() === label);
  for (let waited = 0; waited < 1000 && !lookUp(); waited += 25) {
    await act(async () => {
      await new Promise(resolve => {
        setTimeout(resolve, 25);
      });
    });
  }
  return defined(lookUp(), `menu item "${label}"`);
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.find.mockReset();
});

describe("ThingsActions", () => {
  it("says what it does, in the glossary's words", async () => {
    const { container } = await renderActions();

    expect(container.textContent).toContain("Things");
    expect(container.textContent).toContain("Find things in photos");
    expect(container.textContent).toContain("after the list of things changed");
  });

  it("finds things in the photos that have none", async () => {
    const { find } = await renderActions();

    await click(find);

    expect(stubs.find).toHaveBeenCalledTimes(1);
    expect(stubs.find).toHaveBeenCalledWith(false);
  });

  it("asks before finding things again in every photo, and says the user's tags stay", async () => {
    const { more } = await renderActions();

    await click(more);
    await click(await menuItem(AGAIN));

    expect(stubs.find).not.toHaveBeenCalled();
    expect(openDialog()?.textContent).toContain("Find things again for all photos?");
    expect(openDialog()?.textContent).toContain("Your own tags and keywords stay as they are.");

    await click(dialogButton("Find again"));

    const [fullScan, options] = defined(stubs.find.mock.calls[0]);
    expect(fullScan).toBe(true);
    await act(async () => options?.onSettled?.());
    expect(openDialog()).toBeNull();
  });

  it("is off with the reason while a job runs", async () => {
    const { find, more } = await renderActions({ busyReason: BUSY });

    expectDisabledWithReason(find, BUSY);
    expectDisabledWithReason(more, BUSY);
    await click(find);
    expect(stubs.find).not.toHaveBeenCalled();
  });

  it("tells an admin where to turn Things on while they are off", async () => {
    const { container, find } = await renderActions({ available: false });
    const reason = i18n.t("settings.thingsdisabled");

    expect(container.textContent).toContain(reason);
    expectDisabledWithReason(find, reason);
  });

  it("tells everyone else to ask the administrator", async () => {
    const { container, more } = await renderActions({ available: false, isAdmin: false });
    const reason = i18n.t("settings.thingsdisablednonadmin");

    expect(container.textContent).toContain(reason);
    expectDisabledWithReason(more, reason);
  });
});
