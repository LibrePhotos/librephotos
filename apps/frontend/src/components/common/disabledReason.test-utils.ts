import { act } from "react";
import { expect } from "vitest";

/** The text of every tooltip on the page (Mantine renders them in a portal). */
export function tooltipText(): string {
  return Array.from(document.querySelectorAll(".mantine-Tooltip-tooltip"))
    .map(el => el.textContent ?? "")
    .join("|");
}

/**
 * Waits until a tooltip shows (its open state and transition settle on their own schedule, slower on
 * a busy CI runner), for at most a second. Only for a tooltip that should appear.
 */
async function waitForTooltip() {
  for (let waited = 0; waited < 1000 && tooltipText() === ""; waited += 25) {
    await act(async () => {
      await new Promise(resolve => {
        setTimeout(resolve, 25);
      });
    });
  }
}

/** Moves keyboard focus to the control, as Tab would, and returns the tooltips then shown. */
export async function focusAndReadTooltip(control: HTMLElement): Promise<string> {
  await act(async () => {
    control.focus();
  });
  await waitForTooltip();
  return tooltipText();
}

/** Points at the control. */
export async function hover(control: HTMLElement) {
  await act(async () => {
    // floating-ui's hover listens for the native mouseenter on the target.
    control.dispatchEvent(new MouseEvent("mouseenter"));
    control.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

/** Points at the control and returns the tooltips then shown. */
export async function hoverAndReadTooltip(control: HTMLElement): Promise<string> {
  await hover(control);
  await waitForTooltip();
  return tooltipText();
}

/**
 * A control that cannot be used and says why (#2237): reported as disabled to assistive technology,
 * still focusable (a `disabled` button fires no hover or focus events, so its tooltip never showed),
 * and described by the reason.
 */
export function expectDisabledWithReason(control: HTMLElement, reason: string) {
  expect(control.getAttribute("aria-disabled")).toBe("true");
  expect(control.hasAttribute("disabled")).toBe(false);
  const describedBy = control.getAttribute("aria-describedby") ?? "";
  const description = describedBy
    .split(" ")
    .map(id => document.getElementById(id)?.textContent ?? "")
    .join(" ");
  expect(description).toContain(reason);
}
