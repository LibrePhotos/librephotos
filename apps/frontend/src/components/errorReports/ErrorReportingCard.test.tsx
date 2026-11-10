/**
 * #2938: Error reporting on the Admin page. Off by default; a server the environment does not name
 * cannot be picked and says why; what a report holds is listed; turning sharing on with saved
 * reports asks first, shows them, and sends them only when the admin says so.
 */
import type { ErrorReport, SiteSettingsUpdate } from "@librephotos/api-client";
import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, dialogButton, openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { ErrorReportingCard } from "./ErrorReportingCard";

type Settings = {
  error_reporting?: string;
  error_reporting_own_server?: boolean;
  error_reporting_maintainers?: boolean;
};

const stubs = vi.hoisted(() => ({
  settings: undefined as Settings | undefined,
  reports: [] as ErrorReport[],
  saved: [] as { input: SiteSettingsUpdate; onSaved?: () => void; onFailed?: () => void }[],
  sendAll: vi.fn<(variables: undefined) => void>(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("../../api_client/settings/hooks", () => ({ useGetSettingsQuery: () => ({ data: stubs.settings }) }));
vi.mock("../../api_client/errorReports", () => ({
  useErrorReportsQuery: () => ({ data: stubs.reports }),
  useSendAllErrorReportsMutation: () => ({ mutate: stubs.sendAll }),
}));
vi.mock("../settings/useSaveSiteSettings", () => ({
  useSaveSiteSettings: () => (input: SiteSettingsUpdate, onSaved?: () => void, onFailed?: () => void) =>
    stubs.saved.push({ input, onSaved, onFailed }),
}));
vi.mock("../settings/SettingsSection", () => ({ SectionLink: () => null }));

function report(id: number, title: string, sentAt: string | null = null): ErrorReport {
  return {
    id,
    source: "server",
    title,
    level: "error",
    release: "dev",
    occurrences: 1,
    first_seen: "2026-11-08T10:00:00Z",
    last_seen: "2026-11-08T10:00:00Z",
    sent_at: sentAt,
  };
}

function choice(container: HTMLElement, value: string): HTMLInputElement {
  return defined(
    [...container.querySelectorAll<HTMLInputElement>("input[type=radio]")].find(input => input.value === value),
    `the ${value} choice`
  );
}

async function pick(container: HTMLElement, value: string) {
  await click(choice(container, value));
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  stubs.settings = { error_reporting: "off", error_reporting_own_server: false, error_reporting_maintainers: true };
  stubs.reports = [];
  stubs.saved = [];
});

describe("ErrorReportingCard", () => {
  it("is off by default and lists what a report holds and what it never does", async () => {
    const { container } = await renderInMantine(<ErrorReportingCard />);
    expect(choice(container, "off").checked).toBe(true);
    const text = container.textContent ?? "";
    expect(text).toContain(i18n.t("errorreports.sent_error"));
    expect(text).toContain(i18n.t("errorreports.never_sent"));
    expect(container.querySelector('a[href="/admin/error-reports"]')).not.toBeNull();
  });

  it("cannot pick my own server without SENTRY_DSN, and says why", async () => {
    const { container } = await renderInMantine(<ErrorReportingCard />);
    expect(choice(container, "own_server").disabled).toBe(true);
    expect(choice(container, "maintainers").disabled).toBe(false);
    expect(container.textContent).toContain(i18n.t("errorreports.own_server_unavailable"));
  });

  it("turns sharing on at once when nothing is saved", async () => {
    const { container } = await renderInMantine(<ErrorReportingCard />);
    await pick(container, "maintainers");
    expect(openDialog()).toBeNull();
    expect(stubs.saved.map(({ input }) => input)).toEqual([{ error_reporting: "maintainers" }]);
  });

  it("asks about the saved reports, shows them, and sends only new ones when told so", async () => {
    stubs.reports = [report(1, "KeyError: 'width'"), report(2, "already sent", "2026-11-08T11:00:00Z")];
    const { container } = await renderInMantine(<ErrorReportingCard />);
    expect(container.textContent).toContain("1 report not sent yet");

    await pick(container, "maintainers");
    const dialog = defined(openDialog(), "the opt-in dialog");
    expect(dialog.textContent).toContain("KeyError: 'width'");
    expect(dialog.textContent).not.toContain("already sent");
    expect(stubs.saved).toEqual([]);

    await click(dialogButton(i18n.t("errorreports.optin_new_only")));
    const [only] = stubs.saved;
    expect(defined(only).input).toEqual({ error_reporting: "maintainers" });
    defined(only).onSaved?.();
    expect(stubs.sendAll).not.toHaveBeenCalled();
  });

  it("sends the saved reports too, once the setting is saved", async () => {
    stubs.reports = [report(1, "KeyError: 'width'")];
    const { container } = await renderInMantine(<ErrorReportingCard />);
    await pick(container, "maintainers");
    await click(dialogButton(i18n.t("errorreports.optin_send_saved")));

    const onSaved = defined(defined(stubs.saved[0]).onSaved, "the after-save step");
    expect(stubs.sendAll).not.toHaveBeenCalled();
    onSaved();
    expect(stubs.sendAll).toHaveBeenCalledOnce();
  });

  it("stays open until the choice is saved, and after a refused save", async () => {
    stubs.reports = [report(1, "KeyError: 'width'")];
    const { container } = await renderInMantine(<ErrorReportingCard />);
    await pick(container, "maintainers");
    await click(dialogButton(i18n.t("errorreports.optin_send_saved")));
    expect(openDialog()).not.toBeNull();

    await act(async () => defined(defined(stubs.saved[0]).onFailed, "the refused-save step")());
    expect(openDialog()).not.toBeNull();
    expect(stubs.sendAll).not.toHaveBeenCalled();

    await click(dialogButton(i18n.t("errorreports.optin_send_saved")));
    await act(async () => defined(defined(stubs.saved[1]).onSaved, "the after-save step")());
    expect(openDialog()).toBeNull();
  });

  it("Cancel leaves the setting as it was", async () => {
    stubs.reports = [report(1, "KeyError: 'width'")];
    const { container } = await renderInMantine(<ErrorReportingCard />);
    await pick(container, "maintainers");
    await click(dialogButton(i18n.t("errorreports.cancel")));
    expect(stubs.saved).toEqual([]);
  });

  it("is hidden for a backend without error reporting", async () => {
    stubs.settings = {};
    const { container } = await renderInMantine(<ErrorReportingCard />);
    expect(container.querySelector("input[type=radio]")).toBeNull();
    expect(container.textContent).not.toContain(i18n.t("errorreports.setting"));
  });
});
