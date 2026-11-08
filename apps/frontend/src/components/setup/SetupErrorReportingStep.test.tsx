/**
 * #2938: the first-time setup's error reporting step. It says in a few lines what reports are for
 * and hold, and saves the admin's choice through the site setting. Off is the default and one
 * click; a server the environment does not name cannot be picked.
 */
import type { SiteSettingsUpdate } from "@librephotos/api-client";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { SetupErrorReportingStep } from "./SetupErrorReportingStep";

const stubs = vi.hoisted(() => ({
  settings: {} as {
    error_reporting?: string;
    error_reporting_own_server?: boolean;
    error_reporting_maintainers?: boolean;
  },
  saved: [] as SiteSettingsUpdate[],
  onDone: vi.fn<() => void>(),
}));

vi.mock("../../api_client/settings/hooks", () => ({ useGetSettingsQuery: () => ({ data: stubs.settings }) }));
vi.mock("../../api_client/errorReports", () => ({
  useErrorReportsQuery: () => ({ data: [] }),
  useSendAllErrorReportsMutation: () => ({ mutate: () => undefined }),
}));
vi.mock("../settings/useSaveSiteSettings", () => ({
  useSaveSiteSettings: () => (input: SiteSettingsUpdate, onSaved?: () => void) => {
    stubs.saved.push(input);
    onSaved?.();
  },
}));

function button(container: HTMLElement, label: string): HTMLButtonElement {
  return defined(
    [...container.querySelectorAll("button")].find(candidate => candidate.textContent?.trim() === label),
    `the ${label} button`
  );
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  stubs.saved = [];
  stubs.settings = { error_reporting: "off", error_reporting_own_server: false, error_reporting_maintainers: true };
});

describe("SetupErrorReportingStep", () => {
  it("explains error reporting in a few lines", async () => {
    const { container } = await renderInMantine(<SetupErrorReportingStep onDone={stubs.onDone} />);
    const text = container.textContent ?? "";
    expect(text).toContain(i18n.t("errorreports.intro_purpose"));
    expect(text).toContain(i18n.t("errorreports.intro_consent"));
    expect(text).toContain(i18n.t("errorreports.intro_contents"));
  });

  it("keeps reports off in one click and moves on", async () => {
    const { container } = await renderInMantine(<SetupErrorReportingStep onDone={stubs.onDone} />);
    const off = button(container, i18n.t("errorreports.off"));
    // The first choice, and the one that stands out.
    expect(container.querySelector("button")).toBe(off);
    await click(off);
    expect(stubs.saved).toEqual([{ error_reporting: "off" }]);
    expect(stubs.onDone).toHaveBeenCalledOnce();
  });

  it("saves sharing with the maintainers", async () => {
    const { container } = await renderInMantine(<SetupErrorReportingStep onDone={stubs.onDone} />);
    await click(button(container, i18n.t("errorreports.maintainers")));
    expect(stubs.saved).toEqual([{ error_reporting: "maintainers" }]);
    expect(stubs.onDone).toHaveBeenCalledOnce();
  });

  it("cannot pick my own server without SENTRY_DSN, and says why", async () => {
    const { container } = await renderInMantine(<SetupErrorReportingStep onDone={stubs.onDone} />);
    const own = button(container, i18n.t("errorreports.own_server"));
    expect(own.getAttribute("aria-disabled")).toBe("true");
    await click(own);
    expect(stubs.saved).toEqual([]);
    // DisabledReason keeps the reason in the page for screen readers and shows it on hover.
    expect(document.body.textContent).toContain(i18n.t("errorreports.own_server_unavailable"));
  });

  it("saves my own server when it is set up", async () => {
    stubs.settings = { ...stubs.settings, error_reporting_own_server: true };
    const { container } = await renderInMantine(<SetupErrorReportingStep onDone={stubs.onDone} />);
    await click(button(container, i18n.t("errorreports.own_server")));
    expect(stubs.saved).toEqual([{ error_reporting: "own_server" }]);
  });
});
