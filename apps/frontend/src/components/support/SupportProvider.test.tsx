/**
 * The support prompts: an admin sees the thank-you dialog once, after their library is processed;
 * around Christmas each user's Rewind opens once. Closing either saves it on the user (one PATCH),
 * and neither shows while files upload. Rewind's last slide asks admins to sponsor the project and
 * everyone else to star it.
 */
import { userKeys, type ProcessingStatus, type Rewind, type User } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import { testUser } from "../whatsnew/whatsNewFixture.test-utils";
import { testRewind } from "./rewind/rewindFixture.test-utils";
import { useSupport } from "./supportContext";
import { SupportProvider } from "./SupportProvider";

const GB = 1000 ** 3;

const stubs = vi.hoisted(() => ({
  settings: { support_prompts_enabled: true, rewind_enabled: true },
  status: undefined as ProcessingStatus | undefined,
  rewind: undefined as Rewind | undefined,
  uploads: [] as unknown[],
  patch: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
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
vi.mock("../../api_client/stats/hooks/useRewindQuery", () => ({ useRewindQuery: () => ({ data: stubs.rewind }) }));
vi.mock("../../api_client/stats/hooks/useFetchCountStatsQuery", () => ({
  useFetchCountStatsQuery: () => ({
    data: {
      num_photos: 52340,
      num_people: 214,
      num_places: 389,
      library_bytes: 418 * GB,
    },
  }),
}));
vi.mock("../upload", () => ({ useUpload: () => ({ items: stubs.uploads }) }));

const READY: ProcessingStatus = {
  photo_count: 52340,
  stages: [{ key: "thumbnails", remaining: 0, unmatched: 0, running_job: null, last_run: null }],
};

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;

/** Opens Rewind like the account menu does. */
function MenuItem() {
  const support = useSupport();
  return (
    <button type="button" onClick={() => support.openRewind(2026)}>
      menu
    </button>
  );
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
}

async function render(user: User) {
  queryClient.setQueryData(userKeys.selfDetail("7"), user);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MantineProvider env="test">
          <SupportProvider>
            <MenuItem />
          </SupportProvider>
        </MantineProvider>
      </QueryClientProvider>
    );
  });
  await settle();
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const buttonNamed = (name: string, within: ParentNode = document) =>
  defined(
    [...within.querySelectorAll<HTMLElement>("button")].find(
      button => button.getAttribute("aria-label") === name || button.textContent?.trim() === name
    ),
    `the ${name} button`
  );
const linkNamed = (name: string, within: ParentNode = document) =>
  [...within.querySelectorAll<HTMLAnchorElement>("a")].find(link => link.textContent?.trim() === name);

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
  await settle();
}

const admin = (overrides: Record<string, unknown> = {}) =>
  testUser({ is_superuser: true, support_prompt_seen: false, rewind_seen_year: 0, ...overrides });

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
  await Promise.all([import("./ThankYouModal"), import("./rewind/RewindModal")]);
});

beforeEach(() => {
  // Outside Rewind's season unless a test says otherwise; only Date is faked, timers run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 2));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  stubs.settings = { support_prompts_enabled: true, rewind_enabled: true };
  stubs.status = READY;
  stubs.rewind = testRewind();
  stubs.uploads = [];
  stubs.patch.mockReset();
  // The server answers with the saved user: the cached one with the change.
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

describe("the thank-you dialog", () => {
  it("shows an admin what LibrePhotos did and what the cloud would cost", async () => {
    await render(admin());
    const open = defined(dialog(), "the dialog");
    expect(open.textContent).toContain("Your library is ready");
    expect(open.textContent).toContain("52,340");
    expect(open.textContent).toContain("Storing your 418 GB elsewhere would cost about");
    expect(open.textContent).toContain("Google One 2 TB");
    expect(open.textContent).toContain("$99.99 / year");
    expect(linkNamed("Donate via PayPal", open)?.href).toContain("paypal.com/donate");
    expect(linkNamed("Sponsor", open)?.href).toBe("https://github.com/sponsors/derneuere");
    expect(stubs.patch).not.toHaveBeenCalled();
  });

  it("is saved as seen when closed, and is gone", async () => {
    await render(admin());
    await click(buttonNamed("Close", defined(dialog())));
    expect(stubs.patch).toHaveBeenCalledTimes(1);
    expect(stubs.patch).toHaveBeenCalledWith("/user/7/", { support_prompt_seen: true });
    expect(dialog()).toBeNull();
  });

  it("is saved as seen when one of its links opens", async () => {
    await render(admin());
    await click(defined(linkNamed("Star on GitHub", defined(dialog()))));
    expect(stubs.patch).toHaveBeenCalledWith("/user/7/", { support_prompt_seen: true });
    expect(dialog()).toBeNull();
  });

  it("waits for the library to be processed, and for uploads", async () => {
    stubs.status = { ...READY, stages: [{ ...defined(READY.stages[0]), remaining: 3 }] };
    await render(admin());
    expect(dialog()).toBeNull();
    stubs.status = READY;
    stubs.uploads = [{ id: "a" }];
    await render(admin());
    expect(dialog()).toBeNull();
  });

  it("never shows to a user, a second time, or on a server that turned it off", async () => {
    await render(testUser({ support_prompt_seen: false, rewind_seen_year: 0 }));
    expect(dialog()).toBeNull();
    await render(admin({ support_prompt_seen: true }));
    expect(dialog()).toBeNull();
    stubs.settings = { support_prompts_enabled: false, rewind_enabled: true };
    await render(admin());
    expect(dialog()).toBeNull();
  });
});

describe("Rewind", () => {
  const goToEnd = async () => {
    for (let i = 0; i < 6; i++) {
      const next = buttonNamed("Next");
      if (next.hasAttribute("disabled")) break;
      await click(next);
    }
  };

  it("opens once around Christmas, and asks a user for a star at the end", async () => {
    vi.setSystemTime(new Date(2026, 11, 24));
    await render(testUser({ rewind_seen_year: 2025 }));
    const open = defined(dialog(), "Rewind");
    expect(open.getAttribute("aria-label")).toBe("Rewind 2026");
    expect(open.textContent).toContain("Rewind 2026");
    await click(buttonNamed("Next"));
    expect(dialog()?.textContent).toContain("4,118");
    await goToEnd();
    expect(dialog()?.textContent).toContain("All of this stayed at home.");
    expect(linkNamed("Star on GitHub")).toBeDefined();
    expect(linkNamed("Sponsor")).toBeUndefined();
    await click(buttonNamed("Close Rewind"));
    expect(stubs.patch).toHaveBeenCalledWith("/user/7/", { rewind_seen_year: 2026 });
    expect(dialog()).toBeNull();
  });

  it("asks an admin to sponsor at the end", async () => {
    vi.setSystemTime(new Date(2027, 0, 2));
    await render(admin({ support_prompt_seen: true }));
    await goToEnd();
    expect(linkNamed("Sponsor")).toBeDefined();
    expect(linkNamed("Donate via PayPal")).toBeDefined();
    expect(dialog()?.textContent).toContain("$99.99");
  });

  it("waits for the thank-you dialog, and does not open for a thin year or a seen one", async () => {
    vi.setSystemTime(new Date(2026, 11, 24));
    await render(admin());
    expect(dialog()?.textContent).toContain("Your library is ready");
    stubs.rewind = testRewind({ photo_count: 5, video_count: 0 });
    await render(testUser({ rewind_seen_year: 0 }));
    expect(dialog()).toBeNull();
    stubs.rewind = testRewind();
    await render(testUser({ rewind_seen_year: 2026 }));
    expect(dialog()).toBeNull();
  });

  it("opens from the account menu outside the season too, without saving a year", async () => {
    await render(testUser({ rewind_seen_year: 2026 }));
    expect(dialog()).toBeNull();
    await click(buttonNamed("menu"));
    expect(dialog()?.getAttribute("aria-label")).toBe("Rewind 2026");
    await click(buttonNamed("Close Rewind"));
    expect(stubs.patch).not.toHaveBeenCalled();
  });
});
