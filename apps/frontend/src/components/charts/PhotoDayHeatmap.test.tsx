import { Settings } from "luxon";
import React, { act } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { PhotoDayHeatmap } from "./PhotoDayHeatmap";

const stubs = vi.hoisted(() => ({
  counts: [
    { day: "1998-07-14", count: 2 },
    { day: "2021-03-03", count: 5 },
    { day: "2024-08-01", count: 1 },
  ],
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => Promise.resolve() }));
vi.mock("../../api_client/stats/hooks", () => ({
  useFetchPhotoDayCountQuery: () => ({ data: stubs.counts, isSuccess: true, isLoading: false }),
}));
vi.mock("../common/useListFailure", () => ({ useListFailure: () => null }));
vi.mock("@mantine/hooks", async importOriginal => ({
  ...(await importOriginal<typeof import("@mantine/hooks")>()),
  useElementSize: () => ({ ref: () => {}, width: 1200, height: 0 }),
}));

const yearPicker = () => defined(document.body.querySelector<HTMLInputElement>("input[aria-label='Year']"));
const cellDays = () =>
  [...document.body.querySelectorAll<SVGGElement>("g[role='link']")].map(cell => cell.getAttribute("aria-label"));

let locale: string;
beforeAll(async () => {
  setUpMantineDom();
  Element.prototype.scrollIntoView ??= () => {};
  locale = Settings.defaultLocale;
  Settings.defaultLocale = "en-US";
  await i18n.changeLanguage("en");
});

afterAll(() => {
  Settings.defaultLocale = locale;
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("PhotoDayHeatmap", () => {
  it("shows the latest year with photos and offers every year with photos, before 2000 too", async () => {
    await renderInMantine(<PhotoDayHeatmap />);
    expect(yearPicker().value).toBe("2024");
    expect(cellDays()[0]).toMatch(/^Jan 1, 2024:/);

    await act(async () => {
      yearPicker().focus();
      yearPicker().click();
    });
    const options = [...document.body.querySelectorAll<HTMLElement>("[role='option']")];
    expect(options.map(option => option.textContent)).toEqual(["2024", "2021", "1998"]);

    await act(async () => defined(options.find(option => option.textContent === "1998")).click());
    expect(yearPicker().value).toBe("1998");
    expect(cellDays()).toHaveLength(365);
    expect(cellDays()).toContain("Jul 14, 1998: 2 photos");
  });

  it("says in one line that there is nothing to draw", async () => {
    const counts = stubs.counts;
    stubs.counts = [];
    try {
      await renderInMantine(<PhotoDayHeatmap />);
      expect(document.body.textContent).toContain("No dated photos yet");
      expect(document.body.querySelector("a, button")).toBeNull();
      expect(document.body.querySelector("input[aria-label='Year']")).toBeNull();
    } finally {
      stubs.counts = counts;
    }
  });
});
