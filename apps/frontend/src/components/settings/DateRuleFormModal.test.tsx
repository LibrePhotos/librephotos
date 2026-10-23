/**
 * The custom date rule form (#2272): the rule object it saves, the file-name pattern check that
 * keeps Save off, and the server's 400 shown next to the field it names.
 */
import { ApiError, type DateRuleOptions, type DateTimeRule } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import { emptyFormValues, type DateRuleFormValues } from "./dateRuleForm";
import { DateRuleFormModal, type DateRuleDraft } from "./DateRuleFormModal";

type Callbacks = { onSuccess?: () => void; onError?: (error: unknown) => void };
const stubs = vi.hoisted(() => ({
  check: vi.fn<(rule: DateTimeRule, callbacks?: Callbacks) => void>(),
}));

const OPTIONS: DateRuleOptions = {
  date_tags: [
    { name: "EXIF:DateTimeOriginal", utc: false },
    { name: "QuickTime:MediaCreateDate", utc: true },
  ],
  condition_tags: ["EXIF:Model"],
  first_custom_id: 1000,
};

vi.mock("../../api_client/settings/hooks/useDateRuleOptionsQuery", () => ({
  useDateRuleOptionsQuery: () => ({ data: OPTIONS }),
}));
vi.mock("../../api_client/settings/hooks/useFetchTimezonesQuery", () => ({
  useFetchTimezonesQuery: () => ({ data: ["Europe/Berlin", "UTC"] }),
}));
vi.mock("../../api_client/settings/hooks/useCheckDateRuleMutation", () => ({
  useCheckDateRuleMutation: () => ({ mutate: stubs.check, isPending: false }),
}));

const onSave = vi.fn<(rule: DateTimeRule) => void>();
const onClose = vi.fn<() => void>();
let root: Root;

beforeAll(async () => {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // jsdom has no ResizeObserver; the SegmentedControl measures its options with it
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.check.mockReset();
  stubs.check.mockImplementation((_rule, callbacks) => callbacks?.onSuccess?.());
  onSave.mockReset();
  onClose.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
});

async function open(values: Partial<DateRuleFormValues>, id = 1000) {
  const draft: DateRuleDraft = { values: { ...emptyFormValues(), ...values }, id, editing: false };
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <DateRuleFormModal opened onClose={onClose} draft={draft} onSave={onSave} />
      </MantineProvider>
    );
  });
}

function saveButton() {
  return defined(Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Save Rule"));
}

function inputLabelled(label: string) {
  return defined(
    Array.from(document.querySelectorAll<HTMLInputElement>("input")).find(
      input => input.labels?.[0]?.textContent?.startsWith(label) ?? false
    )
  );
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

async function typeInto(label: string, value: string) {
  const input = inputLabelled(label);
  const setValue = defined(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set);
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("DateRuleFormModal", () => {
  it("saves a QuickTime:MediaCreateDate rule recorded in UTC, converted to the GPS time zone", async () => {
    await open({ source: "exif", exifTag: "QuickTime:MediaCreateDate", name: "" });

    await click(inputLabelled("Recorded in UTC"));
    // The name follows the choices until the user writes one.
    expect(inputLabelled("Name").value).toBe(
      "QuickTime:MediaCreateDate in UTC, converted to the timezone at the GPS location"
    );
    await click(saveButton());

    expect(stubs.check).toHaveBeenCalledTimes(1);
    const rule = defined(onSave.mock.calls[0])[0];
    expect(rule).toEqual({
      id: 1000,
      name: "QuickTime:MediaCreateDate in UTC, converted to the timezone at the GPS location",
      custom: true,
      rule_type: "exif",
      exif_tag: "QuickTime:MediaCreateDate",
      transform_tz: 1,
      source_tz: "utc",
      report_tz: "gps_timezonefinder",
    });
    expect(rule.id).toBeGreaterThanOrEqual(1000);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows why a file-name pattern cannot be used and keeps Save off", async () => {
    await open({ source: "path", fileNamePattern: "custom", datePattern: "YYYY-MM-DD", name: "Names" });
    // Luxon puts a narrow no-break space before AM.
    expect(document.body.textContent).toMatch(/Reads Jan 1, 2023, 12:00:00\sAM/);

    await typeInto("Pattern", "MM-DD HH");

    expect(document.body.textContent).toContain("The pattern needs the year (YYYY), month (MM) and day (DD).");
    expectDisabledWithReason(saveButton(), "Fix the marked fields first.");
    await click(saveButton());
    expect(stubs.check).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the server's 400 next to the field it names and keeps the form open", async () => {
    stubs.check.mockImplementation((_rule, callbacks) =>
      callbacks?.onError?.(
        new ApiError(
          400,
          "/datetime-rules/check/",
          "bad",
          { errors: [{ field: "condition_path", message: "Must be plain text.", code: "invalid_date_rule" }] },
          "Must be plain text."
        )
      )
    );
    await open({ source: "filesystem", fileProperty: "ctime", name: "Scans", conditionPath: "Scans" });

    await click(saveButton());

    expect(document.body.textContent).toContain("Must be plain text.");
    expect(inputLabelled("The folder path contains").getAttribute("aria-invalid")).toBe("true");
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says so when the server could not check the rule", async () => {
    stubs.check.mockImplementation((_rule, callbacks) => callbacks?.onError?.(new Error("network")));
    await open({ source: "filesystem", name: "Scans" });

    await click(saveButton());

    expect(document.body.textContent).toContain("The server could not check the rule. Try again.");
  });
});
