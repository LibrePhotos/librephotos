/**
 * #2938: the Error reports page. Each saved report offers Send once, Download, Email and Delete;
 * the list offers Send all and Delete all (after a confirm). Email is a mailto link to the one
 * address, with the subject and a summary that asks for the downloaded file. Admins only.
 */
import type { ErrorReport } from "@librephotos/api-client";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, dialogButton, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { REPORT_EMAIL } from "./errorReportEmail";
import { ErrorReportsPage } from "./ErrorReportsPage";

const stubs = vi.hoisted(() => ({
  superuser: true,
  reports: [] as ErrorReport[],
  send: vi.fn<(reportId: number) => void>(),
  sendAll: vi.fn<(variables: undefined) => void>(),
  remove: vi.fn<(reportId: number) => void>(),
  removeAll: vi.fn<(variables: undefined) => void>(),
  save: vi.fn<(reportId: number) => Promise<void>>(async () => undefined),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => () => undefined,
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { is_superuser: stubs.superuser } }),
}));
vi.mock("../../api_client/errorReports", () => ({
  useErrorReportsQuery: () => ({ data: stubs.reports, isPending: false, isError: false }),
  useSendErrorReportMutation: () => ({ mutate: stubs.send, isPending: false }),
  useSendAllErrorReportsMutation: () => ({ mutate: stubs.sendAll, isPending: false }),
  useDeleteErrorReportMutation: () => ({ mutate: stubs.remove, isPending: false }),
  useDeleteAllErrorReportsMutation: () => ({ mutate: stubs.removeAll, isPending: false }),
  saveErrorReportFile: stubs.save,
}));
vi.mock("../PageHeader", () => ({ PageHeader: ({ title }: { title: React.ReactNode }) => <h1>{title}</h1> }));

const REPORT: ErrorReport = {
  id: 7,
  source: "browser",
  title: "TypeError: Cannot read properties of undefined (reading 'name')",
  level: "error",
  release: "2026w44",
  occurrences: 3,
  first_seen: "2026-11-08T10:00:00Z",
  last_seen: "2026-11-08T11:00:00Z",
  sent_at: null,
};

function button(container: HTMLElement, label: string): HTMLElement {
  return defined(
    [...container.querySelectorAll<HTMLElement>("button, a")].find(element => element.textContent?.trim() === label),
    `the ${label} button`
  );
}

async function render() {
  const { container } = await renderInMantine(<ErrorReportsPage />);
  return container;
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  stubs.superuser = true;
  stubs.reports = [REPORT, { ...REPORT, id: 8, title: "older", source: "server", sent_at: "2026-11-08T12:00:00Z" }];
});

describe("ErrorReportsPage", () => {
  it("lists each report with where it came from, how often and whether it was sent", async () => {
    const container = await render();
    const rows = container.querySelectorAll('[data-testid="error-report"]');
    expect(rows).toHaveLength(2);
    const first = defined(rows[0]).textContent ?? "";
    expect(first).toContain(REPORT.title);
    expect(first).toContain("Web app");
    expect(first).toContain("3 times");
    expect(first).toContain("Not sent");
    expect(defined(rows[1]).textContent).toContain("Sent");
    expect(container.textContent).toContain("1 report not sent yet");
  });

  it("sends once, downloads and deletes one report", async () => {
    const container = await render();
    const row = defined(container.querySelector<HTMLElement>('[data-testid="error-report"]'));
    await click(button(row, "Send once"));
    expect(stubs.send.mock.calls[0]?.[0]).toBe(7);
    await click(button(row, "Download"));
    expect(stubs.save).toHaveBeenCalledWith(7);
    await click(button(row, "Delete"));
    expect(stubs.remove.mock.calls[0]?.[0]).toBe(7);
  });

  it("emails the maintainers a summary that asks for the downloaded file", async () => {
    const container = await render();
    const row = defined(container.querySelector<HTMLElement>('[data-testid="error-report"]'));
    const href = defined(button(row, "Email").getAttribute("href"));
    const url = new URL(href);
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe(REPORT_EMAIL);
    expect(url.searchParams.get("subject")).toBe(`LibrePhotos error report: ${REPORT.title}`);
    const body = defined(url.searchParams.get("body"));
    expect(body).toContain("Release: 2026w44");
    expect(body).toContain("Times: 3");
    expect(body).toContain("librephotos-error-report-7.json");
    expect(container.textContent).toContain(i18n.t("errorreports.email_hint"));
  });

  it("sends all, and deletes all after a confirm", async () => {
    const container = await render();
    await click(button(container, "Send all"));
    expect(stubs.sendAll).toHaveBeenCalledOnce();

    await click(button(container, "Delete all"));
    expect(stubs.removeAll).not.toHaveBeenCalled();
    await click(dialogButton("Delete all"));
    expect(stubs.removeAll).toHaveBeenCalledOnce();
  });

  it("says so when there are no reports", async () => {
    stubs.reports = [];
    const container = await render();
    expect(container.textContent).toContain(i18n.t("errorreports.empty_title"));
  });

  it("is for admins only", async () => {
    stubs.superuser = false;
    const container = await render();
    expect(container.textContent).toContain(i18n.t("adminarea.unauthorized"));
    expect(container.querySelector('[data-testid="error-report"]')).toBeNull();
  });
});
