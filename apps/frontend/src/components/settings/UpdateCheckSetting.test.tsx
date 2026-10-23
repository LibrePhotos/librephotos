/**
 * #2311: Check for new releases in Site Settings. The switch says what the check sends (nothing
 * about the server) and what it last found, offers Show it again for a skipped release, and is
 * locked off by UPDATE_CHECK=false in the server environment.
 */
import type { SiteSettingsUpdate, UpdateStatus } from "@librephotos/api-client";
import { DateTime } from "luxon";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { UpdateCheckSetting } from "./UpdateCheckSetting";

const stubs = vi.hoisted(() => ({
  settings: { update_check: true } as { update_check?: boolean } | undefined,
  status: undefined as UpdateStatus | undefined,
  statusEnabled: [] as boolean[],
  save: vi.fn<(input: SiteSettingsUpdate) => void>(),
  skip: vi.fn<(version: string) => void>(),
}));

vi.mock("../../api_client/settings/hooks", () => ({ useGetSettingsQuery: () => ({ data: stubs.settings }) }));
vi.mock("../../api_client/server", () => ({
  useFetchImageTagQuery: () => ({ data: { image_tag: "dev", git_hash: "abc1234" } }),
  useSkipReleaseMutation: () => ({ mutate: stubs.skip }),
  useUpdateStatusQuery: ({ enabled }: { enabled: boolean }) => {
    stubs.statusEnabled.push(enabled);
    return { data: enabled ? stubs.status : undefined };
  },
}));
vi.mock("./useSaveSiteSettings", () => ({ useSaveSiteSettings: () => stubs.save }));

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    enabled: true,
    locked: false,
    status: "up_to_date",
    current: "1.5.0",
    latest: "1.5.0",
    update_available: false,
    notice: false,
    release_url: null,
    published_at: null,
    checked_at: DateTime.now().minus({ hours: 2 }).toISO(),
    error: null,
    install_type: "docker",
    how_to_update_url: "https://docs.librephotos.com/docs/installation/upgrading",
    skipped_release: null,
    snoozed_until: null,
    ...overrides,
  };
}

async function render() {
  const { container } = await renderInMantine(<UpdateCheckSetting />);
  return container;
}

function toggle(container: HTMLElement): HTMLInputElement {
  return defined(container.querySelector<HTMLInputElement>("input[type=checkbox]"), "the switch");
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  stubs.settings = { update_check: true };
  stubs.status = status();
  stubs.statusEnabled = [];
});

describe("UpdateCheckSetting", () => {
  it("says what it sends and what the last check found", async () => {
    const container = await render();
    expect(toggle(container).checked).toBe(true);
    expect(container.textContent).toContain("Check for new releases");
    expect(container.textContent).toContain("Nothing about this server is sent");
    expect(container.textContent).toContain("Up to date: 1.5.0 is the newest release. Checked 2 hours ago.");
  });

  it("saves the switch", async () => {
    const container = await render();
    await click(toggle(container));
    expect(stubs.save).toHaveBeenCalledWith({ update_check: false });
  });

  it("offers Show it again for a skipped release", async () => {
    stubs.status = status({ status: "skipped", latest: "1.6.0", skipped_release: "1.6.0" });
    const container = await render();
    expect(container.textContent).toContain("1.6.0 is available, but you skipped it.");
    const showAgain = defined(
      [...container.querySelectorAll("button")].find(button => button.textContent === "Show it again"),
      "Show it again"
    );
    await click(showAgain);
    expect(stubs.skip).toHaveBeenCalledWith("");
  });

  it.each([
    [{ status: "failed", error: "timeout" }, "failed (timeout). LibrePhotos tries again tomorrow."],
    [{ status: "off", enabled: false }, "Off. LibrePhotos does not contact github.com."],
    [{ status: "development", current: "dev" }, "Development build (commit abc1234)"],
    [{ status: "not_checked", checked_at: null }, "Not checked yet."],
    [{ status: "available", latest: "1.6.0" }, "1.6.0 is available. Checked 2 hours ago."],
  ])("explains %j", async (overrides, text) => {
    stubs.status = status(overrides);
    const container = await render();
    expect(container.textContent).toContain(text);
  });

  it("says nothing more for a state it does not know", async () => {
    stubs.status = status({ status: "from_a_newer_server" });
    const container = await render();
    expect(container.querySelector("[role=status]")).toBeNull();
  });

  it("is locked off by the server environment", async () => {
    stubs.status = status({ status: "locked", locked: true, enabled: false });
    const container = await render();
    const input = toggle(container);
    expect(input.checked).toBe(false);
    expect(input.disabled).toBe(true);
    expect(container.textContent).toContain("Locked");
    expect(container.textContent).toContain("UPDATE_CHECK=false");
    expect(container.querySelector("[role=status]")).toBeNull();
  });

  it("is not there for an older server without the switch", async () => {
    stubs.settings = {};
    const container = await render();
    expect(container.querySelector("input")).toBeNull();
    expect(stubs.statusEnabled.every(enabled => !enabled)).toBe(true);
  });
});
