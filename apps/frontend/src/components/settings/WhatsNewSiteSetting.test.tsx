/**
 * #2305: Show users what's new after an update, in Site Settings, and Show what's new after updates
 * on the user's own Settings page (Interface card). Each is hidden for a server that does not send it.
 */
import type { SiteSettingsUpdate, User } from "@librephotos/api-client";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { testUser } from "../whatsnew/whatsNewFixture.test-utils";
import { InterfaceCard } from "./InterfaceCard";
import { WhatsNewSiteSetting } from "./WhatsNewSiteSetting";

const stubs = vi.hoisted(() => ({
  settings: { whats_new_enabled: true } as { whats_new_enabled?: boolean } | undefined,
  save: vi.fn<(input: SiteSettingsUpdate) => void>(),
  change: vi.fn<(patch: Partial<User>) => void>(),
}));

vi.mock("../../api_client/settings/hooks", () => ({ useGetSettingsQuery: () => ({ data: stubs.settings }) }));
vi.mock("./useSaveSiteSettings", () => ({ useSaveSiteSettings: () => stubs.save }));

const switchIn = (container: HTMLElement) =>
  defined(container.querySelector<HTMLInputElement>('input[type="checkbox"]'), "the switch");

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  stubs.settings = { whats_new_enabled: true };
});

describe("WhatsNewSiteSetting", () => {
  it("turns the card off for every user", async () => {
    const { container } = await renderInMantine(<WhatsNewSiteSetting />);
    expect(container.textContent).toContain("Show users what's new after an update");
    expect(switchIn(container).checked).toBe(true);
    await click(switchIn(container));
    expect(stubs.save).toHaveBeenCalledWith({ whats_new_enabled: false });
  });

  it("is hidden for a server without the setting", async () => {
    stubs.settings = {};
    const { container } = await renderInMantine(<WhatsNewSiteSetting />);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });
});

describe("InterfaceCard", () => {
  it("lets a user turn the card off for themselves", async () => {
    const { container } = await renderInMantine(<InterfaceCard user={testUser()} onChange={stubs.change} />);
    expect(container.textContent).toContain("Show what's new after updates");
    await click(switchIn(container));
    expect(stubs.change).toHaveBeenCalledWith({ show_whats_new: false });
  });

  it("has no switch for a server without the setting", async () => {
    const { container } = await renderInMantine(
      <InterfaceCard user={testUser({ show_whats_new: undefined })} onChange={stubs.change} />
    );
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });
});
