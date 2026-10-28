/**
 * #2305: the What's new card shows once per user after an update. Closing it or opening the dialog
 * saves the release on the server (one PATCH of `last_seen_release`) and the card is gone; it never
 * shows when the user or the server turned it off, and waits while the upload card is open. The
 * account menu and the version line open the dialog through `useWhatsNew()`.
 */
import { userKeys, type User } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import { useWhatsNew } from "./whatsNewContext";
import { testUser } from "./whatsNewFixture.test-utils";
import { WhatsNewProvider } from "./WhatsNewProvider";

const stubs = vi.hoisted(() => ({
  tag: "1.4.0",
  enabled: true as boolean | undefined,
  uploads: [] as unknown[],
  upgradeTasks: 0,
  patch: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  navigate: vi.fn<(options: unknown) => Promise<void>>(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => stubs.navigate }));
vi.mock("../../api_client/api", () => ({ apiClient: { patch: stubs.patch } }));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  // The cached user, as the app has it; the save updates it in place.
  useCurrentUserSelfDetailsQuery: () =>
    useQuery<User>({ queryKey: userKeys.selfDetail("7"), queryFn: () => new Promise<User>(() => {}) }),
}));
vi.mock("../../api_client/server", () => ({
  useFetchImageTagQuery: () => ({ data: { image_tag: stubs.tag, git_hash: "" } }),
}));
vi.mock("../../api_client/settings/hooks", () => ({
  useGetSettingsQuery: () => ({ data: { whats_new_enabled: stubs.enabled } }),
}));
vi.mock("../../api_client/jobs/hooks/useUpgradeTasks", () => ({
  useOpenUpgradeTaskCount: (isAdmin: boolean) => (isAdmin ? stubs.upgradeTasks : 0),
}));
vi.mock("../upload", () => ({ useUpload: () => ({ items: stubs.uploads }) }));
vi.mock("./whatsNewReleases", async () => ({
  WHATS_NEW_RELEASES: (await import("./whatsNewFixture.test-utils")).RELEASES,
}));

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;

/** A button that opens the dialog like the account menu does. */
function MenuItem() {
  const whatsNew = useWhatsNew();
  return (
    <button type="button" onClick={() => whatsNew.open()}>
      menu
    </button>
  );
}

async function settle() {
  // The card and the dialog are lazy: let their imports and the queries resolve.
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
          <WhatsNewProvider>
            <MenuItem />
          </WhatsNewProvider>
        </MantineProvider>
      </QueryClientProvider>
    );
  });
  await settle();
}

const card = () => document.querySelector<HTMLElement>('[data-testid="whats-new-card"]');
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const buttonNamed = (name: string, within: ParentNode = document) =>
  defined(
    [...within.querySelectorAll<HTMLElement>("button")].find(
      button => button.getAttribute("aria-label") === name || button.textContent?.trim() === name
    ),
    `the ${name} button`
  );

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
  await settle();
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
  // Load the lazy card and dialog once, so a test does not wait on the first import.
  await Promise.all([import("./WhatsNewCard"), import("./WhatsNewModal")]);
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  stubs.tag = "1.4.0";
  stubs.enabled = true;
  stubs.uploads = [];
  stubs.upgradeTasks = 0;
  stubs.patch.mockReset();
  stubs.patch.mockImplementation(async (_endpoint, data) => testUser(typeof data === "object" ? { ...data } : {}));
  stubs.navigate.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("WhatsNewCard", () => {
  it("shows the after-update steps and highlights once, without the admin-only ones", async () => {
    await render(testUser());
    const shown = defined(card(), "the card");
    expect(shown.getAttribute("aria-label")).toBe("What's new in LibrePhotos 1.4.0");
    expect(shown.textContent).toContain("After the update");
    const titles = [...shown.querySelectorAll("li p:first-child")].map(item => item.textContent);
    expect(titles).toEqual([
      "Title of rescan",
      "Title of edits",
      "Title of many",
      "Title of filters",
      "Title of collections",
    ]);
    expect(shown.querySelector('a[href="https://docs.librephotos.com/blog/1-4-0"]')).not.toBeNull();
    expect(stubs.patch).not.toHaveBeenCalled();
  });

  it("saves the release once when closed, and is gone", async () => {
    await render(testUser());
    await click(buttonNamed("Close What's new", defined(card())));
    expect(stubs.patch).toHaveBeenCalledTimes(1);
    expect(stubs.patch).toHaveBeenCalledWith("/user/7/", { last_seen_release: "1.4.0" });
    expect(card()).toBeNull();
  });

  it("opens the dialog on the unseen releases and saves the release", async () => {
    await render(testUser({ last_seen_release: "1.2.0" }));
    expect(card()?.textContent).toContain("2 updates since your last visit");
    await click(buttonNamed("See what's new", defined(card())));
    expect(stubs.patch).toHaveBeenCalledWith("/user/7/", { last_seen_release: "1.4.0" });
    expect(card()).toBeNull();
    const open = defined(dialog(), "the dialog");
    expect(open.textContent).toContain("What 1.4.0 brings.");
    // 1.4.0's after-update step for everyone, then its four highlights for everyone.
    expect(open.textContent).toContain("After the update");
    expect(open.querySelectorAll("h3")).toHaveLength(5);
  });

  it("never shows when the user or the server turned it off", async () => {
    await render(testUser({ show_whats_new: false }));
    expect(card()).toBeNull();
    stubs.enabled = false;
    await render(testUser());
    expect(card()).toBeNull();
    expect(stubs.patch).not.toHaveBeenCalled();
  });

  it("waits while the upload card is open", async () => {
    stubs.uploads = [{ id: "a" }];
    await render(testUser());
    expect(card()).toBeNull();
  });

  it("remembers a new user's release without showing anything", async () => {
    await render(testUser({ last_seen_release: "", date_joined: "2026-10-20T00:00:00Z" }));
    expect(card()).toBeNull();
    expect(stubs.patch).toHaveBeenCalledTimes(1);
    expect(stubs.patch).toHaveBeenCalledWith("/user/7/", { last_seen_release: "1.4.0" });
  });

  it("tells an admin about the upgrade tasks left, with a link to them", async () => {
    stubs.upgradeTasks = 2;
    await render(testUser({ is_superuser: true }));
    const shown = defined(card());
    expect(shown.textContent).toContain("2 tasks to finish the upgrade.");
    // Both after-update steps (one only for admins) and four highlights.
    expect(shown.querySelectorAll("li")).toHaveLength(6);
    await click(buttonNamed("Open", shown));
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/admin", hash: "admin-upgrade" });
  });
});

describe("WhatsNewModal", () => {
  it("opens from the account menu on the running release and the ones before it", async () => {
    await render(testUser({ last_seen_release: "1.4.0" }));
    expect(card()).toBeNull();
    await click(buttonNamed("menu"));
    const open = defined(dialog(), "the dialog");
    expect(open.textContent).toContain("What 1.4.0 brings.");
    // Several releases: a switch between them.
    const labels = [...open.querySelectorAll("label")].map(label => label.textContent);
    expect(labels).toEqual(["1.4.0", "1.3.0", "1.2.0"]);
    expect(stubs.patch).not.toHaveBeenCalled();
  });

  it("switches release, and closes", async () => {
    await render(testUser({ last_seen_release: "1.4.0" }));
    await click(buttonNamed("menu"));
    const second = defined(
      [...defined(dialog()).querySelectorAll<HTMLInputElement>("input[type=radio]")].find(
        input => input.value === "1.3.0"
      )
    );
    await click(second);
    expect(dialog()?.textContent).toContain("What 1.3.0 brings.");
    expect(dialog()?.querySelector('a[href="https://docs.librephotos.com/blog/1-3-0"]')).not.toBeNull();
    await click(buttonNamed("Close", defined(dialog())));
    expect(dialog()).toBeNull();
  });

  it("opens a highlight's place in the app and closes", async () => {
    const { RELEASES } = await import("./whatsNewFixture.test-utils");
    const first = defined(RELEASES[0]?.highlights[0]);
    first.open_in_app = "/search";
    await render(testUser({ last_seen_release: "1.4.0" }));
    await click(buttonNamed("menu"));
    await click(buttonNamed("Open", defined(dialog())));
    expect(stubs.navigate).toHaveBeenCalledWith({ href: "/search" });
    expect(dialog()).toBeNull();
    delete first.open_in_app;
  });
});
