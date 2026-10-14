/**
 * The lightbox row and photo page lines of a trashed photo (#2203): when it was trashed and, with
 * the trash retention on, when it is deleted for good.
 */
import { DateTime } from "luxon";
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { parseInstant } from "../../util/dateUtils";
import { renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { TrashedItem, TrashExpiryText } from "./TrashedItem";

const stubs = vi.hoisted(() => ({ retentionDays: undefined as number | undefined }));
vi.mock("../../api_client/settings/hooks", () => ({
  useGetSettingsQuery: () => ({ data: { trash_retention_days: stubs.retentionDays } }),
}));

const daysAgo = (days: number) => DateTime.now().minus({ days, hours: 1 }).toISO();
const textOf = (container: HTMLElement) => [...container.querySelectorAll("p")].map(p => p.textContent).join(" | ");

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

afterEach(() => {
  stubs.retentionDays = undefined;
  document.body.innerHTML = "";
});

describe("TrashedItem", () => {
  it("says when the photo was trashed and when it goes", async () => {
    stubs.retentionDays = 30;
    const trashedAt = daysAgo(11);
    const { container } = await renderInMantine(<TrashedItem trashedAt={trashedAt} />);

    const trashedOn = parseInstant(trashedAt ?? "").toLocaleString(DateTime.DATE_MED);
    expect(textOf(container)).toContain(`Moved to the trash on ${trashedOn}`);
    expect(textOf(container)).toContain("Deleted for good in 19 days, on");
  });

  it("only says when it was trashed while the retention is off", async () => {
    stubs.retentionDays = 0;
    const { container } = await renderInMantine(<TrashedItem trashedAt={daysAgo(400)} />);

    expect(textOf(container)).toMatch(/^Moved to the trash on [^|]+$/);
  });

  it("says a photo past its date goes at the next cleanup", async () => {
    stubs.retentionDays = 7;
    const { container } = await renderInMantine(<TrashExpiryText trashedAt={daysAgo(9)} />);

    expect(textOf(container)).toContain("Deleted for good at the next daily cleanup");
  });

  it("renders nothing without a trashed-on date (an older server)", async () => {
    stubs.retentionDays = 30;
    const { container } = await renderInMantine(<TrashedItem trashedAt={null} />);

    expect(container.querySelector("p")).toBeNull();
  });
});
