/**
 * #2938: the one-time question for instances from before error reporting. Admins only, once: an
 * answer, Not now and the first-time setup's step all mark it answered on the server (the site
 * settings' error_reporting_asked), so it never shows again on any device. With saved reports, it
 * offers to review them and asks about sending them like the Admin page does.
 */
import type { ErrorReport, ProcessingStatus, SiteSettingsUpdate } from "@librephotos/api-client";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, dialogButton, openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { PromptQueueProvider } from "../prompts/PromptQueueProvider";
import { errorReportingPromptPending } from "./askAboutErrorReporting";
import { ErrorReportingPrompt } from "./ErrorReportingPrompt";

type Settings = {
  error_reporting?: string;
  error_reporting_asked?: boolean;
  error_reporting_own_server?: boolean;
  error_reporting_maintainers?: boolean;
  support_prompts_enabled?: boolean;
};

const stubs = vi.hoisted(() => ({
  user: { id: 1, is_superuser: true, support_prompt_seen: true } as
    { id: number; is_superuser: boolean; support_prompt_seen: boolean } | undefined,
  settings: {} as Settings,
  reports: [] as ErrorReport[],
  uploads: [] as unknown[],
  saved: [] as SiteSettingsUpdate[],
  status: undefined as ProcessingStatus | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: stubs.user }),
}));
vi.mock("../../api_client/settings/hooks", () => ({ useGetSettingsQuery: () => ({ data: stubs.settings }) }));
vi.mock("../../api_client/errorReports", () => ({
  useErrorReportsQuery: () => ({ data: stubs.reports }),
  useSendAllErrorReportsMutation: () => ({ mutate: () => undefined }),
}));
vi.mock("../upload", () => ({ useUpload: () => ({ items: stubs.uploads }) }));
// The library is processed unless a test says otherwise; only the thank-you dialog reads it.
vi.mock("../../api_client/jobs/hooks/useProcessingStatus", () => ({
  useProcessingStatusUntil: () => ({ data: stubs.status }),
}));
vi.mock("../settings/useSaveSiteSettings", () => ({
  // The server's answer marks the question answered, as the backend does.
  useSaveSiteSettings: () => (input: SiteSettingsUpdate, onSaved?: () => void) => {
    stubs.saved.push(input);
    stubs.settings = { ...stubs.settings, error_reporting_asked: true };
    onSaved?.();
  },
}));

function report(id: number): ErrorReport {
  return {
    id,
    source: "server",
    title: `KeyError: ${id}`,
    level: "error",
    release: "dev",
    occurrences: 1,
    first_seen: "2026-11-08T10:00:00Z",
    last_seen: "2026-11-08T10:00:00Z",
    sent_at: null,
  };
}

const READY: ProcessingStatus = {
  photo_count: 5,
  stages: [{ key: "thumbnails", remaining: 0, unmatched: 0, running_job: null, last_run: null }],
};

async function render() {
  const view = await renderInMantine(
    <PromptQueueProvider>
      <ErrorReportingPrompt />
    </PromptQueueProvider>
  );
  // The dialog loads on first use.
  await vi.waitFor(() => undefined);
  return view;
}

// The first test imports the lazy dialog cold, which takes a second or two on a busy machine.
async function dialogShows(timeout = 4000): Promise<boolean> {
  try {
    await vi.waitFor(() => expect(openDialog()).not.toBeNull(), { timeout });
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.user = { id: 1, is_superuser: true, support_prompt_seen: true };
  stubs.settings = { error_reporting: "off", error_reporting_asked: false, error_reporting_maintainers: true };
  stubs.reports = [];
  stubs.uploads = [];
  stubs.saved = [];
  stubs.status = READY;
});

describe("errorReportingPromptPending", () => {
  const admin = { is_superuser: true, support_prompt_seen: true };
  it.each([
    ["an admin who was never asked", admin, { error_reporting_asked: false }, true],
    ["a user who is not an admin", { ...admin, is_superuser: false }, { error_reporting_asked: false }, false],
    ["an answered question", admin, { error_reporting_asked: true }, false],
    ["an older backend", admin, {}, false],
  ])("%s", (_name, user, settings, pending) => {
    expect(errorReportingPromptPending(user, settings)).toBe(pending);
  });
});

describe("ErrorReportingPrompt", () => {
  it("asks an existing instance's admin, with the short explanation and the choices", async () => {
    await render();
    expect(await dialogShows()).toBe(true);
    const dialog = defined(openDialog());
    expect(dialog.textContent).toContain(i18n.t("errorreports.intro_purpose"));
    expect(dialog.textContent).toContain(i18n.t("errorreports.intro_contents"));
    for (const label of ["off", "maintainers", "own_server", "prompt_not_now"] as const) {
      expect(dialogButton(i18n.t(`errorreports.${label}`))).toBeDefined();
    }
  });

  it("never asks someone who is not an admin", async () => {
    stubs.user = { id: 2, is_superuser: false, support_prompt_seen: true };
    await render();
    expect(await dialogShows(500)).toBe(false);
  });

  it("never asks again once answered, or after the first-time setup's step", async () => {
    stubs.settings = { ...stubs.settings, error_reporting_asked: true };
    await render();
    expect(await dialogShows(500)).toBe(false);
  });

  it("keeps Not now on the server and closes", async () => {
    const { rerender } = await render();
    expect(await dialogShows()).toBe(true);
    await click(dialogButton(i18n.t("errorreports.prompt_not_now")));
    expect(stubs.saved).toEqual([{ error_reporting_asked: true }]);
    await rerender(<ErrorReportingPrompt />);
    expect(openDialog()).toBeNull();
  });

  it("saves an answer through the site setting", async () => {
    await render();
    expect(await dialogShows()).toBe(true);
    await click(dialogButton(i18n.t("errorreports.maintainers")));
    expect(stubs.saved).toEqual([{ error_reporting: "maintainers" }]);
  });

  it("offers to review saved reports, and asks about sending them before sharing", async () => {
    stubs.reports = [report(1), report(2)];
    await render();
    expect(await dialogShows()).toBe(true);
    const review = defined(
      [...defined(openDialog()).querySelectorAll("a")].find(link => link.textContent === "Review the 2 saved reports")
    );
    expect(review.getAttribute("href")).toBe("/admin/error-reports");

    await click(dialogButton(i18n.t("errorreports.maintainers")));
    expect(stubs.saved).toEqual([]);
    expect(defined(openDialog()).textContent).toContain(i18n.t("errorreports.optin_title"));
    await click(dialogButton(i18n.t("errorreports.optin_new_only")));
    expect(stubs.saved).toEqual([{ error_reporting: "maintainers" }]);
  });

  it("asks an admin whose thank-you dialog waits for a library that never finishes processing", async () => {
    stubs.user = { id: 1, is_superuser: true, support_prompt_seen: false };
    stubs.settings = { ...stubs.settings, support_prompts_enabled: true };
    stubs.status = {
      photo_count: 601,
      stages: [{ key: "captions", remaining: 561, unmatched: 0, running_job: null, last_run: null }],
    };
    await render();
    expect(await dialogShows()).toBe(true);
  });

  it("waits while files upload", async () => {
    stubs.uploads = [{}];
    await render();
    expect(await dialogShows(500)).toBe(false);
  });
});
