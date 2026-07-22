/**
 * Repro for https://github.com/LibrePhotos/librephotos/issues/832
 * "Default timezone not being applied"
 *
 * Backend contract (api/date_time_extractor.py, TimeExtractionRule docstring):
 *
 *   "The goal is to help extract local time, but for historical reason it is
 *    expected the returned datetime will have timezone to be set to pytz.utc
 *    (so local time + timezone equal to UTC)."
 *
 * i.e. `Photo.exif_timestamp` holds the *local wall-clock time the picture was
 * taken*, merely tagged with a UTC offset as a marker. A photo whose filename is
 * `...2023-04-21-12-40-22-085-80gfz.jpg` is stored as `2023-04-21 12:40:22+00`
 * and the API hands it to the client as "2023-04-21T12:40:22+00:00".
 *
 * The lightbox renders it with `DateTime.fromISO(photoDetail.exif_timestamp)`,
 * which resolves into the *browser's* zone. For the reporter (Australia/Perth,
 * UTC+8) 12:40 is therefore shown as 8:40 PM — the exact symptom in the issue.
 * The wall-clock time must be shown verbatim, whatever zone the viewer sits in.
 */
import { MantineProvider } from "@mantine/core";
import i18n from "i18next";
import { Settings } from "luxon";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TimestampItem } from "../components/lightbox/TimestampItem";

// The component only uses this to PATCH edits; irrelevant to rendering, and
// mocking it keeps react-query's provider out of the picture.
vi.mock("../api_client/photos/hooks", () => ({
  useUpdatePhotoMutation: () => ({ mutate: vi.fn() }),
}));

// The reporter's browser zone: Australia/Perth, UTC+8, no DST.
const VIEWER_ZONE = "Australia/Perth";
const originalZone = Settings.defaultZone;

// jsdom ships no matchMedia; MantineProvider needs it to resolve the color scheme.
function stubMatchMedia() {
  if (typeof window.matchMedia === "function") return;
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

async function renderLabel(exifTimestamp: string): Promise<string> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <TimestampItem photoDetail={{ image_hash: "deadbeef", exif_timestamp: exifTimestamp }} isPublic />
      </MantineProvider>
    );
  });
  // The label lives in the button; container.textContent would also drag in
  // Mantine's injected <style> blocks.
  const text = container.querySelector("button")?.textContent ?? "";
  await act(async () => {
    root.unmount();
  });
  container.remove();
  return text;
}

describe("issue 832 - default timezone not being applied", () => {
  beforeAll(async () => {
    stubMatchMedia();
    await i18n.changeLanguage("en");
    Settings.defaultZone = VIEWER_ZONE;
  });

  afterAll(() => {
    Settings.defaultZone = originalZone;
  });

  it("shows the extracted local wall-clock time, not the viewer-zone shift of it", async () => {
    // Issue example 1: filename "...2023-04-21-12-40-22-085-80gfz.jpg", no EXIF.
    // The "using filename assuming timestamp is local" rule yields 12:40:22 local,
    // which the backend persists as 2023-04-21 12:40:22+00.
    const label = await renderLabel("2023-04-21T12:40:22+00:00");

    expect(label).toMatch(/12:40/);
    // The reported symptom: 12:40 rendered as 8:40 PM in a UTC+8 browser.
    expect(label).not.toMatch(/8:40/);
  });

  it("keeps the calendar day of a late-evening photo", async () => {
    // 2023-04-21 is a Friday; shifting by +8h rolls it into Saturday the 22nd,
    // which also drops the photo into the wrong "album date" bucket in the UI.
    const label = await renderLabel("2023-04-21T23:30:00+00:00");

    expect(label).toMatch(/Apr 21, 2023/);
    expect(label).toMatch(/Friday/);
  });
});
