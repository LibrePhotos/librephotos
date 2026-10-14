/**
 * "Change date and time…" of the selection (#2278): Shift previews the oldest and newest photo
 * before and after and stays off at zero; Set gives every photo one date and time.
 */
import type { DateSummary, DateTimeChange } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import { ChangeDateTimeModal } from "./ChangeDateTimeModal";

type Request = { selection: PhotoSelection; change: DateTimeChange };
type Callbacks = { onSuccess?: () => void };
const stubs = vi.hoisted(() => ({
  summary: { current: undefined as DateSummary | undefined },
  mutate: vi.fn<(request: Request, callbacks?: Callbacks) => void>(),
}));

vi.mock("../../api_client/photos/hooks", () => ({
  useDateSummaryQuery: () => ({
    data: stubs.summary.current,
    isError: false,
    isFetching: false,
    refetch: () => Promise.resolve(),
  }),
  useSetPhotosDateTimeMutation: () => ({ mutate: stubs.mutate, isPending: false }),
}));
// The hint reads the user's settings; WriteBackHint.test.tsx covers its texts.
vi.mock("../lightbox/WriteBackHint", () => ({ WriteBackHint: () => null }));

const TRIP: DateSummary = {
  count: 4,
  without_date: 1,
  oldest: { image_hash: "first", exif_timestamp: "2025-10-09T08:14:02Z" },
  newest: { image_hash: "last", exif_timestamp: "2025-10-11T19:40:55Z" },
};
const UNDATED: DateSummary = { count: 2, without_date: 2, oldest: null, newest: null };
const SELECTION: PhotoSelection = { image_hashes: ["first", "middle", "last", "undated"] };

const onClose = vi.fn<() => void>();
const onSaved = vi.fn<() => void>();
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
  stubs.summary.current = TRIP;
  stubs.mutate.mockReset();
  stubs.mutate.mockImplementation((_request, callbacks) => callbacks?.onSuccess?.());
  onClose.mockReset();
  onSaved.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
});

async function open() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <ChangeDateTimeModal opened onClose={onClose} selection={SELECTION} onSaved={onSaved} />
      </MantineProvider>
    );
  });
}

function buttonWithText(text: string) {
  return defined(Array.from(document.querySelectorAll("button")).find(b => b.textContent === text));
}

/** A SegmentedControl option: a radio input with its label. */
function segment(text: string) {
  return defined(Array.from(document.querySelectorAll("label")).find(label => label.textContent === text));
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

function previewRows() {
  return Array.from(document.querySelectorAll("tbody tr")).map(row =>
    Array.from(row.querySelectorAll("th, td")).map(cell => (cell.textContent ?? "").replace(/\s/g, " "))
  );
}

async function typeInto(label: string, value: string) {
  const input = defined(
    Array.from(document.querySelectorAll<HTMLInputElement>("input")).find(
      field => field.labels?.[0]?.textContent === label
    )
  );
  const setValue = defined(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set);
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ChangeDateTimeModal", () => {
  it("opens on Shift with nothing to save until an amount is entered", async () => {
    await open();

    expect(document.body.textContent).toContain("Change date and time of 4 photos");
    expect(document.body.textContent).toContain("No change yet");
    expectDisabledWithReason(buttonWithText("Shift 3 photos"), "Enter how far to move the photos");
    await click(buttonWithText("Shift 3 photos"));
    expect(stubs.mutate).not.toHaveBeenCalled();
  });

  it("previews the oldest and newest photo an hour earlier and shifts them", async () => {
    await open();

    await click(buttonWithText("1 h earlier"));

    expect(document.body.textContent).toContain("1 hour earlier");
    expect(previewRows()).toEqual([
      ["Oldest", "Oct 9, 2025, 8:14:02 AM", "Oct 9, 2025, 7:14:02 AM"],
      ["Newest", "Oct 11, 2025, 7:40:55 PM", "Oct 11, 2025, 6:40:55 PM"],
    ]);
    await click(buttonWithText("Shift 3 photos"));
    expect(stubs.mutate).toHaveBeenCalledTimes(1);
    expect(defined(stubs.mutate.mock.calls[0])[0]).toEqual({
      selection: SELECTION,
      change: { mode: "shift", seconds: -3600 },
    });
    expect(onClose).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it("spells out an amount that overflows its unit", async () => {
    await open();

    await click(segment("Later"));
    await typeInto("Minutes", "90");

    expect(document.body.textContent).toContain("1 hour, 30 minutes later");
    await click(buttonWithText("Shift 3 photos"));
    expect(defined(stubs.mutate.mock.calls[0])[0].change).toEqual({ mode: "shift", seconds: 5400 });
  });

  it("warns that a shift skips the photos without a date", async () => {
    await open();

    expect(document.body.textContent).toContain("1 of the selected photos has no date");
  });

  it("sets every photo to one date and time, starting from the oldest photo's", async () => {
    await open();

    await click(segment("Set"));
    expect(document.body.textContent).toContain("their order in the timeline is lost");
    await click(buttonWithText("Set 4 photos"));

    expect(defined(stubs.mutate.mock.calls[0])[0].change).toEqual({
      mode: "set",
      datetime: "2025-10-09T08:14:02.000Z",
    });
  });

  it("opens on Set when no selected photo has a date", async () => {
    stubs.summary.current = UNDATED;
    await open();

    expect(document.body.textContent).toContain("there is nothing to shift");
    const shift = defined(document.querySelector<HTMLInputElement>('input[value="shift"]'));
    expect(shift.disabled).toBe(true);
    expect(buttonWithText("Set 2 photos")).toBeTruthy();
  });

  it("shows a spinner while the dates of the selection load", async () => {
    stubs.summary.current = undefined;
    await open();

    expect(document.body.textContent).toContain("Change date and time");
    expect(document.querySelector("form")).toBeNull();
  });
});
