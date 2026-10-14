/**
 * #2211: generated captions came only from the caption button of one photo at a time. The Library
 * page's Captions section starts a job over the library: the photos without a generated caption,
 * or, after asking, every photo again.
 */
import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import { click, dialogButton, openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { CaptionsActions } from "./CaptionsActions";

type MutateOptions = { onSettled?: () => void };

const stubs = vi.hoisted(() => ({
  generate: vi.fn<(fullScan: boolean, options?: MutateOptions) => void>(),
}));

vi.mock("../../api_client/jobs/hooks", () => ({
  useGenerateCaptionsMutation: () => ({ mutate: stubs.generate, isPending: false }),
}));

const BUSY = "A job is running.";

async function renderActions(busyReason?: string) {
  const { container } = await renderInMantine(<CaptionsActions busyReason={busyReason} />);
  const buttons = [...container.querySelectorAll("button")];
  return {
    container,
    generate: defined(buttons.find(button => button.textContent?.trim() === "Generate")),
    more: defined(
      container.querySelector<HTMLButtonElement>('button[aria-label="Generate captions again for all photos"]')
    ),
  };
}

/** The menu item `label`, once the dropdown has opened (its transition runs on a timer). */
async function menuItem(label: string): Promise<HTMLElement> {
  const find = () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.trim() === label);
  for (let waited = 0; waited < 1000 && !find(); waited += 25) {
    await act(async () => {
      await new Promise(resolve => {
        setTimeout(resolve, 25);
      });
    });
  }
  return defined(find(), `menu item "${label}"`);
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.generate.mockReset();
});

describe("CaptionsActions", () => {
  it("says what it does and that the user's own captions stay", async () => {
    const { container } = await renderActions();

    expect(container.textContent).toContain("Captions");
    expect(container.textContent).toContain("Generate captions");
    expect(container.textContent).toContain("Captions you wrote yourself are never changed.");
  });

  it("captions the photos that have none", async () => {
    const { generate } = await renderActions();

    await click(generate);

    expect(stubs.generate).toHaveBeenCalledTimes(1);
    expect(stubs.generate).toHaveBeenCalledWith(false);
  });

  it("asks before captioning every photo again", async () => {
    const { more } = await renderActions();

    await click(more);
    await click(await menuItem("Generate captions again for all photos"));

    expect(stubs.generate).not.toHaveBeenCalled();
    expect(openDialog()?.textContent).toContain("Generate captions again for all photos?");

    await click(dialogButton("Generate again"));

    expect(stubs.generate).toHaveBeenCalledTimes(1);
    const [fullScan, options] = defined(stubs.generate.mock.calls[0]);
    expect(fullScan).toBe(true);
    // The dialog stays (loading) until the server has answered.
    await act(async () => options?.onSettled?.());
    expect(openDialog()).toBeNull();
  });

  it("does nothing when the question is cancelled", async () => {
    const { more } = await renderActions();

    await click(more);
    await click(await menuItem("Generate captions again for all photos"));
    await click(dialogButton("Cancel"));

    expect(stubs.generate).not.toHaveBeenCalled();
    expect(openDialog()).toBeNull();
  });

  it("is off with the reason while a job runs", async () => {
    const { generate, more } = await renderActions(BUSY);

    expectDisabledWithReason(generate, BUSY);
    expectDisabledWithReason(more, BUSY);
    await click(generate);
    expect(stubs.generate).not.toHaveBeenCalled();
  });
});
