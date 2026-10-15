/**
 * The automatic library scan row in Site settings (#235): off, every hour, every day at a time, or
 * custom days at a time, saved on change, with the last run's status line under the description.
 */
import type { SiteSettings, SiteSettingsUpdate } from "@librephotos/api-client";
import { Grid, MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import { AutoScanSetting } from "./AutoScanSetting";

const stubs = vi.hoisted(() => ({
  save: vi.fn<(input: SiteSettingsUpdate) => void>(),
  query: { data: undefined as Partial<SiteSettings> | undefined, dataUpdatedAt: 1 },
}));

vi.mock("../../api_client/settings/hooks", () => ({ useGetSettingsQuery: () => stubs.query }));
vi.mock("./useSaveSiteSettings", () => ({ useSaveSiteSettings: () => stubs.save }));

const STATUS = {
  last_run_at: "2026-10-14T03:00:00Z",
  scanned: ["anna"],
  running: [],
  skipped: ["bob"],
  failed: [],
  next_run_at: "2026-10-15T03:00:00Z",
  time_zone: "UTC",
};

let container: HTMLElement;
let root: Root;

async function render(settings: Partial<SiteSettings>) {
  stubs.query = { data: settings, dataUpdatedAt: 1 };
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the dropdown renders in place
      <MantineProvider env="test">
        <Grid>
          <AutoScanSetting />
        </Grid>
      </MantineProvider>
    );
  });
}

function schedule(auto_scan: string, extra: Partial<SiteSettings> = {}): Partial<SiteSettings> {
  return {
    auto_scan,
    auto_scan_time: "03:00",
    auto_scan_days: [0, 1, 2, 3, 4],
    auto_scan_status: STATUS,
    ...extra,
  };
}

const select = () =>
  defined(container.querySelector<HTMLInputElement>('input[aria-label="Scan libraries automatically"]'));
const timeField = () => container.querySelector<HTMLInputElement>('input[aria-label="Start time"]');
const chips = () => Array.from(container.querySelectorAll<HTMLInputElement>('[aria-label="Days"] input'));
/** The weekday chip labelled `name` ("Mon"). */
const chip = (name: string) =>
  defined(
    chips().find(input => container.querySelector(`label[for="${input.id}"]`)?.textContent === name),
    `the ${name} chip`
  );
const picked = () =>
  chips()
    .filter(input => input.checked)
    .map(input => container.querySelector(`label[for="${input.id}"]`)?.textContent);
const statusLine = () => container.querySelector('[role="status"]');

async function choose(label: string) {
  await act(async () => select().click());
  const option = defined(
    Array.from(container.querySelectorAll<HTMLElement>('[role="option"]')).find(el => el.textContent === label),
    `the ${label} option`
  );
  await act(async () => option.click());
}

async function typeTime(value: string) {
  const input = defined(timeField());
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.focus();
    input.blur();
  });
}

beforeAll(async () => {
  setUpMantineDom();
  // The Select scrolls its options into view; jsdom has no layout.
  Element.prototype.scrollIntoView = () => {};
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  stubs.save.mockReset();
});

describe("AutoScanSetting", () => {
  it("is not shown without the schedule (non-staff, older backends)", async () => {
    await render({ allow_upload: true });
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).not.toContain("Scan libraries automatically");
  });

  it("is off by default, with no time, days or status", async () => {
    await render(schedule("off"));
    expect(select().value).toBe("Off");
    expect(timeField()).toBeNull();
    expect(chips()).toEqual([]);
    expect(statusLine()).toBeNull();
  });

  it("shows the time, the server's time zone and the last run every day", async () => {
    await render(schedule("daily"));
    expect(select().value).toBe("Every day");
    expect(timeField()?.value).toBe("03:00");
    expect(container.textContent).toContain("The time is in the server's time zone, UTC.");
    expect(statusLine()?.textContent).toMatch(
      /^Last run .+: 1 library scanned\. Skipped bob: a scan was still running\. Next run .+\.$/
    );
  });

  it("saves a new frequency", async () => {
    await render(schedule("off"));
    await choose("Every hour");
    expect(stubs.save).toHaveBeenCalledWith({ auto_scan: "hourly" });
    expect(timeField()).toBeNull();
  });

  it("saves a changed time, and puts back one that is not a time", async () => {
    await render(schedule("daily"));
    await typeTime("22:30");
    expect(stubs.save).toHaveBeenCalledWith({ auto_scan_time: "22:30" });

    stubs.save.mockReset();
    await typeTime("");
    expect(stubs.save).not.toHaveBeenCalled();
    expect(timeField()?.value).toBe("03:00");
  });

  it("saves the picked days, and nothing while no day is picked", async () => {
    await render(schedule("custom", { auto_scan_days: [0] }));
    expect(chips()).toHaveLength(7);
    expect(picked()).toEqual(["Mon"]);

    await act(async () => chip("Fri").click());
    expect(stubs.save).toHaveBeenLastCalledWith({ auto_scan_days: [0, 4] });

    stubs.save.mockReset();
    await render(schedule("custom", { auto_scan_days: [0] }));
    await act(async () => chip("Mon").click());
    expect(stubs.save).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Pick at least one day. Until you do, the saved schedule stays."
    );
  });
});
