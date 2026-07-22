// UTC+2 in May (CEST), same as the reporter

import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import "@mantine/core/styles.css";
import { TimestampItem } from "../components/lightbox/TimestampItem";

/**
 * Repro for https://github.com/LibrePhotos/librephotos/issues/630
 * '"Time taken" date picker results in the wrong date being set'
 *
 * The reporter is in CEST (UTC+2). Picking "21 May 2022" in the lightbox date
 * picker stores 20 May 2022, 10:00 PM instead.
 *
 * Root cause: src/components/lightbox/TimestampItem.tsx keeps the edited
 * timestamp as a browser-local `Date` and serialises it with
 * `timestamp.toISOString()`, which shifts it by the browser's UTC offset.
 * `exif_timestamp` is, by the backend's own convention
 * (apps/backend/api/date_time_extractor.py: "local time + timezone equal to
 * UTC"), the photo's *local wall clock*, so the offset must not be applied.
 * For any UTC+ browser the wall clock is moved backwards, and whenever the
 * time of day is inside the offset window the calendar date rolls back a day.
 */

// Must be set before anything captures the timezone.
process.env.TZ = "Europe/Berlin";

const updatePhoto = vi.fn();

vi.mock("../api_client/photos/hooks", () => ({
  useUpdatePhotoMutation: () => ({ mutate: updatePhoto }),
}));

// The photo the user is editing. Taken shortly after midnight, so the CEST
// offset is enough to push it into the previous day - exactly the "12:00 AM"
// case in the screenshots attached to the issue.
const PHOTO = {
  image_hash: "issue630hash",
  exif_timestamp: "2022-05-15T00:30:00",
};

// The day the user clicks in the calendar.
const PICKED_DAY = 21;
const EXPECTED_WALL_CLOCK = "2022-05-21T00:30:00";

beforeAll(() => {
  // Pin "today" so the calendar opens on May 2022 and clicking "21" means
  // 21 May 2022. Only Date is faked - timers are left alone for React.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2022, 4, 15, 12, 0, 0));

  // @ts-ignore - jsdom has no matchMedia
  window.matchMedia = (q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  vi.useRealTimers();
});

describe("issue 630: lightbox 'Time taken' date picker", () => {
  it("sends the calendar date the user actually picked", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MantineProvider>
          <TimestampItem photoDetail={PHOTO} isPublic={false} />
        </MantineProvider>
      );
    });

    // Open the "Time taken" editor.
    const editButton = container.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      editButton.click();
    });

    // Click day 21 of the displayed month (May 2022).
    const dayButton = Array.from(container.querySelectorAll<HTMLButtonElement>("table button")).find(
      button => button.getAttribute("data-outside") !== "true" && button.textContent === String(PICKED_DAY)
    );
    expect(dayButton, "day cell for the picked day").toBeTruthy();
    await act(async () => {
      dayButton!.click();
    });

    // Confirm (the green check ActionIcon).
    const actionIcons = container.querySelectorAll<HTMLButtonElement>(".mantine-ActionIcon-root");
    expect(actionIcons.length, "cancel + submit action icons").toBe(2);
    await act(async () => {
      actionIcons[1].click();
    });

    expect(updatePhoto).toHaveBeenCalledTimes(1);
    const sent = updatePhoto.mock.calls[0][0].data.exif_timestamp as string;

    // exif_timestamp carries the photo's local wall clock, so what leaves the
    // browser must still read 2022-05-21 00:30:00 - the user picked 21 May and
    // did not touch the time.
    expect(sent.slice(0, 10), `calendar date sent to the API (payload: ${sent})`).toBe(
      EXPECTED_WALL_CLOCK.slice(0, 10)
    );
    expect(sent.slice(0, 19), `wall clock sent to the API (payload: ${sent})`).toBe(EXPECTED_WALL_CLOCK);
  });
});
