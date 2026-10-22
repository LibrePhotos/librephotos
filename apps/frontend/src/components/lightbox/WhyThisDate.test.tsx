/**
 * "Why this date?" in the info panel (#2272): only on the owner's photos, and the rule a scan takes
 * the date from, marked, among every saved rule's outcome.
 */
import type { DateRulesTest } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api_client/apiError";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { WhyThisDate } from "./WhyThisDate";

const stubs = vi.hoisted(() => ({
  userId: 7 as number | null,
  result: { data: undefined, error: null } as { data: DateRulesTest | undefined; error: unknown },
  asked: [] as (string | undefined)[],
}));

vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ userId: stubs.userId }) }));
vi.mock("../../api_client/settings/hooks/useDateRulesTestQuery", () => ({
  useDateRulesTestQuery: (photoId: string | undefined) => {
    stubs.asked.push(photoId);
    return {
      data: stubs.result.data,
      error: stubs.result.error,
      isError: stubs.result.error !== null,
      isFetching: false,
      refetch: () => Promise.resolve(),
    };
  },
}));

const PHOTO = {
  id: "8f2c1d9e-0b7a-4c55-9a1e-2b3c4d5e6f70",
  owner: { id: 7, username: "a", first_name: "", last_name: "" },
};
const RESULT: DateRulesTest = {
  photo_id: PHOTO.id,
  exif_timestamp: "2024-05-06T07:08:09Z",
  date_set_by_user: false,
  winner: 1,
  outcomes: [
    { rule_id: 1000, name: "Video", outcome: "not_applicable", local_time: null, utc_offset: null, error: null },
    {
      rule_id: 1,
      name: "Camera",
      outcome: "applies",
      local_time: "2024-05-06T07:08:09Z",
      utc_offset: 120,
      error: null,
    },
    { rule_id: 3, name: "", outcome: "applies", local_time: "2023-01-01T12:00:05Z", utc_offset: null, error: null },
    { rule_id: 9, name: "Broken", outcome: "error", local_time: null, utc_offset: null, error: "'Mars/Olympus'" },
  ],
};

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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.userId = 7;
  stubs.result = { data: RESULT, error: null };
  stubs.asked = [];
});

afterEach(async () => {
  await act(async () => root.unmount());
});

async function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // The modal links to the settings page.
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <WhyThisDate photo={PHOTO} /> }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <RouterProvider router={router} />
      </MantineProvider>
    );
  });
}

function why() {
  return Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Why this date?");
}

async function openTest() {
  await act(async () => {
    defined(why()).click();
  });
}

function rows() {
  return Array.from(document.querySelectorAll("tbody tr")).map(row =>
    Array.from(row.querySelectorAll("td")).map(cell => (cell.textContent ?? "").replace(/\s/g, " "))
  );
}

describe("WhyThisDate", () => {
  it("is not offered on another user's photo", async () => {
    stubs.userId = 8;
    await render();
    expect(why()).toBeUndefined();
  });

  it("asks nothing until opened, then shows every rule's outcome with the one a scan uses", async () => {
    await render();
    expect(stubs.asked).toEqual([]);

    await openTest();

    expect(stubs.asked).toContain(PHOTO.id);
    expect(document.body.textContent?.replace(/\s/g, " ")).toContain(
      "A scan takes the date from Camera: May 6, 2024, 7:08:09 AM (UTC+02:00)"
    );
    expect(rows()).toEqual([
      ["Video", "Does not apply"],
      ["CameraUsed", "May 6, 2024, 7:08:09 AM (UTC+02:00)"],
      ["Rule 3", "Jan 1, 2023, 12:00:05 PM"],
      ["Broken", "Cannot run: 'Mars/Olympus'"],
    ]);
  });

  it("says when no rule finds a date, and when the photo shows another one", async () => {
    stubs.result = { data: { ...RESULT, winner: null }, error: null };
    await render();
    await openTest();
    expect(document.body.textContent).toContain("None of your rules finds a date in this photo.");

    await act(async () => root.unmount());
    stubs.result = { data: { ...RESULT, winner: 2 }, error: null };
    await render();
    await openTest();
    expect(document.body.textContent?.replace(/\s/g, " ")).toContain("The photo shows May 6, 2024, 7:08:09 AM now.");
  });

  it("says a date set by hand wins, and marks no rule as used", async () => {
    stubs.result = { data: { ...RESULT, date_set_by_user: true }, error: null };
    await render();
    await openTest();
    expect(document.body.textContent).toContain("This date was set by hand");
    expect(rows()[1]?.[0]).toBe("Camera");
  });

  it("shows the server's reason when the file is gone", async () => {
    stubs.result = {
      data: undefined,
      error: new ApiError("x", 404, "The photo's file is not on disk.", "/datetime-rules/test/"),
    };
    await render();
    await openTest();
    expect(document.body.textContent).toContain("The photo's file is not on disk.");
  });
});
