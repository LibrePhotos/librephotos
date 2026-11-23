import { Settings } from "luxon";
import React, { act } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { WallDisplaySleep } from "./WallDisplaySleep";

const overlay = () => defined(document.body.querySelector<HTMLButtonElement>("button"));

let locale: string;
beforeAll(async () => {
  setUpMantineDom();
  locale = Settings.defaultLocale;
  Settings.defaultLocale = "en-US";
  await i18n.changeLanguage("en");
});

afterAll(() => {
  Settings.defaultLocale = locale;
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WallDisplaySleep", () => {
  it("says when it wakes on a pointer move, then fades the hint out again", async () => {
    await renderInMantine(<WallDisplaySleep onWake={() => {}} wakeAt="07:00" />);
    expect(overlay().textContent).toBe("Sleeping until 7:00 AM · Tap to wake");
    expect(overlay().hasAttribute("data-hint")).toBe(false);

    await act(async () => overlay().dispatchEvent(new MouseEvent("pointermove", { bubbles: true })));
    expect(overlay().hasAttribute("data-hint")).toBe(true);

    await act(async () => vi.advanceTimersByTime(3_000));
    await act(async () => overlay().dispatchEvent(new MouseEvent("pointermove", { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(overlay().hasAttribute("data-hint")).toBe(true);

    await act(async () => vi.advanceTimersByTime(1_500));
    expect(overlay().hasAttribute("data-hint")).toBe(false);
  });

  it("shows the hint on a touch and wakes on a tap", async () => {
    const onWake = vi.fn<() => void>();
    await renderInMantine(<WallDisplaySleep onWake={onWake} wakeAt="06:30" />);

    await act(async () => overlay().dispatchEvent(new Event("touchstart", { bubbles: true })));
    expect(overlay().hasAttribute("data-hint")).toBe(true);
    await act(async () => overlay().click());
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(overlay().getAttribute("aria-label")).toBe("Wake the screen and stop the slideshow");
  });
});
