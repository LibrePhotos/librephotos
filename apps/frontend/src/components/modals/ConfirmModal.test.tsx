/**
 * The shared confirmation for destructive one-click actions (#2223): only the red
 * button may run the action; every other way out just closes the dialog.
 */
import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { ConfirmModal } from "./ConfirmModal";
import { click, dialogButton, openDialog, renderInMantine, setUpMantineDom } from "./confirmModal.test-utils";

const onConfirm = vi.fn<() => void>();
const onClose = vi.fn<() => void>();

function dialog(props: Partial<React.ComponentProps<typeof ConfirmModal>> = {}) {
  return (
    <ConfirmModal
      opened
      onClose={onClose}
      onConfirm={onConfirm}
      title="Delete this face?"
      message="The face of Anna is deleted."
      confirmLabel="Delete face"
      {...props}
    />
  );
}

async function pressEscape() {
  await act(async () => {
    // From inside the dialog, as a real keypress is: Mantine reads the target's attributes.
    (openDialog() ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  onConfirm.mockReset();
  onClose.mockReset();
});

describe("ConfirmModal", () => {
  it("shows the question, what is lost and a confirm button that repeats the verb", async () => {
    await renderInMantine(dialog());

    const text = openDialog()?.textContent ?? "";
    expect(text).toContain("Delete this face?");
    expect(text).toContain("The face of Anna is deleted.");
    expect(dialogButton("Delete face")).toBeTruthy();
  });

  it("runs the action only from the confirm button", async () => {
    await renderInMantine(dialog());

    await click(dialogButton("Delete face"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("only closes on Cancel", async () => {
    await renderInMantine(dialog());

    await click(dialogButton("Cancel"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("only closes on Escape", async () => {
    await renderInMantine(dialog());

    await pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("puts the focus on Cancel, so Enter after a misclick does nothing harmful", async () => {
    await renderInMantine(dialog());

    expect(dialogButton("Cancel").hasAttribute("data-autofocus")).toBe(true);
  });

  it("names the dismiss button when Cancel would be ambiguous", async () => {
    await renderInMantine(dialog({ confirmLabel: "Cancel job", cancelLabel: "Keep running" }));

    await click(dialogButton("Keep running"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says the action cannot be undone only when told so", async () => {
    const { rerender } = await renderInMantine(dialog());
    expect(openDialog()?.textContent).not.toContain("This action cannot be undone.");

    await rerender(dialog({ irreversible: true }));

    expect(openDialog()?.textContent).toContain("This action cannot be undone.");
  });

  it("cannot be dismissed while the action runs", async () => {
    await renderInMantine(dialog({ loading: true }));

    await pressEscape();

    expect(onClose).not.toHaveBeenCalled();
    expect(dialogButton("Cancel").disabled).toBe(true);
  });

  it("renders nothing while closed", async () => {
    await renderInMantine(dialog({ opened: false }));

    expect(openDialog()).toBeNull();
  });
});
