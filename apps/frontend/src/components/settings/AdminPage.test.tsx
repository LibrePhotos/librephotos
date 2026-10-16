/**
 * - /admin showed a bare, untranslated "Unauthorized" to everyone while the
 *   profile loaded, so admins saw it flash on every reload.
 * - "Delete all auto created albums" deleted every event album on one click.
 * - Every card has an anchor for the section navigation (#2226).
 * - The users table reads name first, actions last, like the worker jobs table, without the
 *   user's own scene confidence, and a long scan directory stays on one line (#2244).
 * - The Finish the upgrade card heads the page only while an update left work (#2322).
 */
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { AdminPage } from "./AdminPage";

type SelfDetailsResult = { data: { is_superuser: boolean } | undefined; isPending: boolean };
type ListedUser = {
  id: number;
  username: string;
  scan_directory?: string;
  is_superuser: boolean;
  photo_count: number;
  date_joined: string;
  confidence: number;
};

const mocks = vi.hoisted(() => {
  const selfDetails: SelfDetailsResult = { data: undefined, isPending: true };
  const users: ListedUser[] = [];
  const upgradeTasks: { key: string }[] = [];
  return {
    selfDetails,
    users,
    upgradeTasks,
    upgradeTasksEnabled: [] as boolean[],
    // What the theme's sm breakpoint query answers: true is the desktop layout.
    desktop: false,
    deleteAll: vi.fn<(variables: undefined, options?: { onSettled?: () => void }) => void>(),
  };
});

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => async () => {},
  useLocation: ({ select }: { select: (location: { hash: string }) => string }) => select({ hash: "" }),
}));
vi.mock("../../api_client/albums/hooks", () => ({
  useDeleteAllAutoAlbumsMutation: () => ({ mutate: mocks.deleteAll, isPending: false }),
}));
vi.mock("../../api_client/server/hooks", () => ({ useFetchServerStatsQuery: () => ({ data: {}, isLoading: false }) }));
vi.mock("../../api_client/user/hooks", () => ({
  useFetchUserListQuery: () => ({ data: mocks.users, isFetching: false }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => mocks.selfDetails,
}));
vi.mock("../../api_client/jobs/hooks/useUpgradeTasks", () => ({
  useUpgradeTasksQuery: ({ enabled }: { enabled: boolean }) => {
    mocks.upgradeTasksEnabled.push(enabled);
    return { data: enabled ? { tasks: mocks.upgradeTasks } : undefined };
  },
}));
vi.mock("./FinishUpgradeCard", () => ({ FinishUpgradeCard: () => "finish-upgrade-card" }));
vi.mock("../../i18n", () => ({ i18nResolvedLanguage: () => "en" }));
vi.mock("../job/JobList", () => ({ JobList: () => null }));
vi.mock("../modals/ModalUserDelete", () => ({ ModalUserDelete: () => null }));
vi.mock("../modals/ModalUserEdit", () => ({ ModalUserEdit: () => null }));
vi.mock("./EmailSettings", () => ({ EmailSettings: () => null }));
vi.mock("./FeaturesCard", () => ({ FeaturesCard: () => null }));
vi.mock("./ServerLogsCard", () => ({ ServerLogsCard: () => null }));
vi.mock("./ServiceList", () => ({ ServiceList: () => null }));
vi.mock("./SiteSettings", () => ({ SiteSettings: () => null }));
vi.mock("./StripThumbnailMetadataTool", () => ({ StripThumbnailMetadataTool: () => "strip-thumbnail-metadata-tool" }));
vi.mock("./LookUpPlacesTool", () => ({ LookUpPlacesTool: () => "look-up-places-tool" }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: mocks.desktop,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // jsdom has no ResizeObserver; the chip row's ScrollArea needs it.
  globalThis.ResizeObserver = class ResizeObserverStub implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  mocks.deleteAll.mockReset();
  mocks.users = [];
  mocks.upgradeTasks = [];
  mocks.upgradeTasksEnabled = [];
  mocks.desktop = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      // No transitions, so the confirmation shows without waiting for animation frames.
      <QueryClientProvider client={new QueryClient()}>
        <MantineProvider
          theme={{
            components: {
              Modal: { defaultProps: { transitionProps: { duration: 0 } } },
              Tooltip: { defaultProps: { transitionProps: { duration: 0 } } },
            },
          }}
        >
          <AdminPage />
        </MantineProvider>
      </QueryClientProvider>
    );
  });
}

const buttonByText = (text: string) =>
  [...document.body.querySelectorAll("button")].filter(button => button.textContent?.trim() === text);

describe("AdminPage", () => {
  it("shows neither the page nor a refusal while the profile loads", async () => {
    mocks.selfDetails = { data: undefined, isPending: true };
    await render();

    expect(container.textContent).not.toContain("adminarea.unauthorized");
    expect(container.textContent).not.toContain("adminarea.header");
  });

  it("explains the refusal to a non-admin and offers a way back", async () => {
    mocks.selfDetails = { data: { is_superuser: false }, isPending: false };
    await render();

    expect(container.textContent).toContain("adminarea.unauthorized");
    expect(container.textContent).toContain("adminarea.unauthorizeddescription");
    expect(buttonByText("publicalbum.goHome")).toHaveLength(1);
  });

  it("gives every card a stable id and lists it in the section navigation", async () => {
    mocks.selfDetails = { data: { is_superuser: true }, isPending: false };
    await render();

    // admin-email is inside EmailSettings (mocked here); EmailSettings.test checks it.
    for (const id of [
      "admin-site",
      "admin-features",
      "admin-tools",
      "admin-logs",
      "admin-services",
      "admin-users",
      "admin-jobs",
    ]) {
      expect(document.getElementById(id)?.tagName, id).toBe("SECTION");
    }
    const toc = defined(container.querySelector("nav"), "the section navigation");
    expect([...toc.querySelectorAll("a")].map(link => link.getAttribute("href"))).toEqual([
      "#admin-site",
      "#admin-features",
      "#admin-email",
      "#admin-tools",
      "#admin-logs",
      "#admin-services",
      "#admin-users",
      "#admin-jobs",
    ]);
  });

  it("puts the Finish the upgrade card first while an update left work (#2322)", async () => {
    mocks.selfDetails = { data: { is_superuser: true }, isPending: false };
    mocks.upgradeTasks = [{ key: "probe_videos" }];
    await render();

    expect(document.getElementById("admin-upgrade")?.textContent).toBe("finish-upgrade-card");
    const toc = defined(container.querySelector("nav"), "the section navigation");
    expect(toc.querySelector("a")?.getAttribute("href")).toBe("#admin-upgrade");
  });

  it("has no Finish the upgrade card without tasks, and asks for none for a non-admin", async () => {
    mocks.selfDetails = { data: { is_superuser: true }, isPending: false };
    await render();
    expect(document.getElementById("admin-upgrade")).toBeNull();

    mocks.selfDetails = { data: { is_superuser: false }, isPending: false };
    mocks.upgradeTasksEnabled = [];
    await render();
    expect(mocks.upgradeTasksEnabled.every(enabled => !enabled)).toBe(true);
  });

  it("offers the thumbnail metadata cleanup among the admin tools (#2321)", async () => {
    mocks.selfDetails = { data: { is_superuser: true }, isPending: false };
    await render();

    expect(document.getElementById("admin-tools")?.textContent).toContain("strip-thumbnail-metadata-tool");
  });

  it("offers looking up the place names again among the admin tools (#2302)", async () => {
    mocks.selfDetails = { data: { is_superuser: true }, isPending: false };
    await render();

    expect(document.getElementById("admin-tools")?.textContent).toContain("look-up-places-tool");
  });

  it("asks before deleting all auto created albums", async () => {
    mocks.selfDetails = { data: { is_superuser: true }, isPending: false };
    await render();

    const trigger = defined(buttonByText("adminarea.delete")[0], "the delete button");
    await act(async () => {
      trigger.click();
    });
    expect(mocks.deleteAll).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("adminarea.deleteallautoalbumsexplanation");

    const confirm = buttonByText("adminarea.delete").find(button => button !== trigger);
    if (!confirm) throw new Error("the confirmation has no delete button");
    await act(async () => {
      confirm.click();
    });
    expect(mocks.deleteAll).toHaveBeenCalledTimes(1);
  });

  describe("users table", () => {
    const longPath = "/data/photos/family/archive/scans/1998/summer-holiday/grandparents";
    const admin: ListedUser = {
      id: 1,
      username: "admin",
      scan_directory: longPath,
      is_superuser: true,
      photo_count: 120,
      date_joined: "2024-01-01T00:00:00Z",
      confidence: 0,
    };
    const guest: ListedUser = { ...admin, id: 2, username: "guest", scan_directory: undefined, is_superuser: false };

    const usersTable = () => defined(document.getElementById("admin-users")?.querySelector("table"), "the users table");
    const headers = () => [...usersTable().querySelectorAll("thead th")].map(th => th.textContent);

    beforeEach(() => {
      mocks.selfDetails = { data: { is_superuser: true }, isPending: false };
      mocks.users = [admin, guest];
    });

    it("puts the name first and the actions last, without the scene confidence", async () => {
      mocks.desktop = true;
      await render();

      expect(headers()).toEqual([
        "adminarea.username",
        "adminarea.scandirectory",
        "adminarea.photocount",
        "adminarea.joined",
        "adminarea.actions",
      ]);
      const firstRow = defined(usersTable().querySelector<HTMLTableRowElement>("tbody tr"), "the first user row");
      expect(firstRow.cells).toHaveLength(headers().length);
      expect(firstRow.cells[0]?.textContent).toBe("admin");
      expect(firstRow.cells[4]?.querySelectorAll("button")).toHaveLength(2);
    });

    it("keeps the name, the scan directory and the actions on a phone", async () => {
      await render();

      expect(headers()).toEqual(["adminarea.username", "adminarea.scandirectory", "adminarea.actions"]);
    });

    it("shows a long scan directory on one line, cut at the start, with the full path in a tooltip", async () => {
      await render();

      const path = defined(
        [...usersTable().querySelectorAll<HTMLElement>("[data-truncate]")].find(el => el.textContent === longPath),
        "the scan directory"
      );
      expect(path.dataset.truncate).toBe("start");
      // The leading slash stays at the start of the path in the right-to-left truncated text.
      expect(path.querySelector('[dir="ltr"]')?.textContent).toBe(longPath);
      await act(async () => {
        path.focus();
      });
      const tooltip = defined(document.body.querySelector('[role="tooltip"]'), "the tooltip");
      expect(tooltip.textContent).toBe(longPath);
    });

    it("says not set only for a user without a scan directory", async () => {
      await render();

      const rows = [...usersTable().querySelectorAll("tbody tr")];
      expect(rows.map(row => row.querySelectorAll("td")[1]?.textContent)).toEqual([longPath, "adminarea.notset"]);
    });
  });
});
