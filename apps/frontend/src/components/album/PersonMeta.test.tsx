import { Settings } from "luxon";
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { click, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { PersonMeta } from "./PersonMeta";

const originalLocale = Settings.defaultLocale;

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
  Settings.defaultLocale = "en-US";
});

afterEach(() => {
  document.body.innerHTML = "";
  Settings.defaultLocale = originalLocale;
});

const groups = [{ date: "2012-08-16T10:00:00Z" }, { date: null }];

describe("PersonMeta", () => {
  it("says the day of the photos and offers to add a birth date", async () => {
    const onBirthDate = vi.fn<(from: HTMLElement) => void>();
    await renderInMantine(
      <PersonMeta person={{ name: "Ama", birth_date: null }} groups={groups} onBirthDate={onBirthDate} />
    );

    expect(document.body.textContent).toContain("Aug 16, 2012");
    const add = document.body.querySelector("button");
    expect(add?.textContent).toBe("Add birth date");
    await click(add ?? document.body);
    expect(onBirthDate).toHaveBeenCalledTimes(1);
  });

  it("shows the birth date instead once there is one", async () => {
    await renderInMantine(
      <PersonMeta person={{ name: "Ama", birth_date: "1990-05-03" }} groups={groups} onBirthDate={() => {}} />
    );

    expect(document.body.textContent).toContain("Born May 3, 1990");
    expect(document.body.textContent).not.toContain("Add birth date");
  });
});
