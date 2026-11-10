/**
 * The app shell's prompts take turns through one queue: the thank-you dialog, the one-time error
 * reporting question (#2938) and Rewind are never two dialogs at once, a library that never finishes
 * processing (a stage that never ran) does not hold the question back for good, and a dialog that
 * shows stays when an upload starts or another one becomes due.
 */
import { userKeys, type ProcessingStatus, type Rewind, type User } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { ErrorReportingPrompt } from "../errorReports/ErrorReportingPrompt";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import { PromptQueueProvider } from "../prompts/PromptQueueProvider";
import { testUser } from "../whatsnew/whatsNewFixture.test-utils";
import { testRewind } from "./rewind/rewindFixture.test-utils";
import { SupportProvider } from "./SupportProvider";

const stubs = vi.hoisted(() => ({
  settings: {
    support_prompts_enabled: true,
    rewind_enabled: true,
    error_reporting: "off",
    error_reporting_asked: false,
    error_reporting_maintainers: true,
  },
  status: undefined as ProcessingStatus | undefined,
  rewind: undefined as Rewind | undefined,
  uploads: [] as unknown[],
  patch: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("../../api_client/api", () => ({ apiClient: { patch: stubs.patch } }));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () =>
    useQuery<User>({ queryKey: userKeys.selfDetail("7"), queryFn: () => new Promise<User>(() => {}) }),
}));
vi.mock("../../api_client/settings/hooks", () => ({ useGetSettingsQuery: () => ({ data: stubs.settings }) }));
vi.mock("../../api_client/jobs/hooks/useProcessingStatus", () => ({
  useProcessingStatusUntil: () => ({ data: stubs.status }),
}));
vi.mock("../../api_client/stats/hooks/useRewindQuery", () => ({
  useRewindQuery: (year: number | null) => ({ data: year === null ? undefined : stubs.rewind }),
}));
vi.mock("../../api_client/stats/hooks/useFetchCountStatsQuery", () => ({
  useFetchCountStatsQuery: () => ({
    data: { num_photos: 601, num_people: 3, num_places: 12, library_bytes: 2 * 1000 ** 3 },
  }),
}));
vi.mock("../../api_client/errorReports", () => ({
  useErrorReportsQuery: () => ({ data: [] }),
  useSendAllErrorReportsMutation: () => ({ mutate: () => undefined }),
}));
vi.mock("../settings/useSaveSiteSettings", () => ({
  useSaveSiteSettings: () => () => undefined,
}));
vi.mock("../upload", () => ({ useUpload: () => ({ items: stubs.uploads }) }));

const READY: ProcessingStatus = {
  photo_count: 601,
  stages: [{ key: "thumbnails", remaining: 0, unmatched: 0, running_job: null, last_run: null }],
};
// The maintainer's server (#2945): the captions stage never ran, so the library is never ready.
const NEVER_READY: ProcessingStatus = {
  photo_count: 601,
  stages: [{ key: "captions", remaining: 561, unmatched: 0, running_job: null, last_run: null }],
};

let root: Root;
let queryClient: QueryClient;

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
}

/** The app shell's order: the question next to the support prompts, as in `_protected/route.tsx`. */
async function render(user: User) {
  queryClient.setQueryData(userKeys.selfDetail("7"), user);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MantineProvider env="test">
          <PromptQueueProvider>
            <ErrorReportingPrompt />
            <SupportProvider>{null}</SupportProvider>
          </PromptQueueProvider>
        </MantineProvider>
      </QueryClientProvider>
    );
  });
  await settle();
}

const dialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
const shownTitles = () => dialogs().map(dialog => dialog.textContent ?? "");
const QUESTION = () => i18n.t("errorreports.prompt_title");
const THANK_YOU = "Your library is ready";

const admin = () => testUser({ is_superuser: true, support_prompt_seen: false, rewind_seen_year: 0 });

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
  await Promise.all([
    import("./ThankYouModal"),
    import("./rewind/RewindModal"),
    import("../errorReports/ErrorReportingPromptModal"),
  ]);
});

beforeEach(() => {
  // Outside Rewind's season; only Date is faked, timers run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 8));
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  stubs.rewind = undefined;
  stubs.uploads = [];
  stubs.settings.error_reporting_asked = false;
  stubs.patch.mockReset();
  stubs.patch.mockImplementation(async (_endpoint, data) => ({
    ...defined(queryClient.getQueryData<User>(userKeys.selfDetail("7"))),
    ...(typeof data === "object" ? data : {}),
  }));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("the thank-you dialog and the error reporting question", () => {
  it("asks an admin whose thank-you dialog waits for a library that is not processed", async () => {
    stubs.status = NEVER_READY;
    await render(admin());
    const shown = shownTitles();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain(QUESTION());
  });

  it("shows only the thank-you dialog on a processed library, and asks once it is closed", async () => {
    stubs.status = READY;
    await render(admin());
    const shown = shownTitles();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain(THANK_YOU);

    const close = defined(
      [...defined(dialogs()[0]).querySelectorAll("button")].find(
        button => button.getAttribute("aria-label") === "Close"
      )
    );
    await act(async () => {
      close.click();
    });
    await settle();

    expect(stubs.patch).toHaveBeenCalledWith("/user/7/", { support_prompt_seen: true });
    const after = shownTitles();
    expect(after).toHaveLength(1);
    expect(after[0]).toContain(QUESTION());
  });

  it("keeps the question open when the thank-you dialog becomes due meanwhile", async () => {
    stubs.status = NEVER_READY;
    await render(admin());
    stubs.status = READY;
    await render(admin());

    const shown = shownTitles();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain(QUESTION());
  });

  it("keeps the question open when an upload starts", async () => {
    stubs.status = NEVER_READY;
    await render(admin());
    stubs.uploads = [{ id: "a" }];
    await render(admin());

    expect(shownTitles()).toHaveLength(1);
  });
});

describe("Rewind and the error reporting question", () => {
  it("show one after the other, never at once", async () => {
    vi.setSystemTime(new Date(2026, 11, 24));
    stubs.status = READY;
    stubs.rewind = testRewind();
    const user = testUser({ is_superuser: true, support_prompt_seen: true, rewind_seen_year: 0 });
    await render(user);

    const shown = shownTitles();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain(QUESTION());

    // Answered: the server now says so.
    stubs.settings.error_reporting_asked = true;
    await render(user);
    expect(dialogs().map(dialog => dialog.getAttribute("aria-label"))).toEqual(["Rewind 2026"]);
  });
});
