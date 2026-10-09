/**
 * The Ctrl+K palette offers the same jobs as the Library page, so it has to keep
 * the Library page's safeguards:
 *   - "Delete Missing Photos" drops photo records for good: it asks first.
 *   - A scan without a scan directory fails on the server: admins are sent to the
 *     Library page with a note on how to set one up, everyone else is told who can.
 *     While the user details are still loading nothing happens, so a configured
 *     user is not mistaken for one without a directory.
 * It also only offers the admin area to admins, and search terms with ?, # or /
 * must not break the search route.
 * With nothing typed, a few search suggestions lead and the commands follow: a
 * library with many albums and people must not bury Navigation and Actions.
 * On the default "auto" theme with a dark OS, the theme toggle offers light mode.
 */
import { MantineProvider } from "@mantine/core";
import type { MantineColorScheme } from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { SearchOptionType } from "../../service/use-search";
import type { SearchOption } from "../../service/use-search";
import { useSpotlightActions } from "./useSpotlightActions";
import type { SpotlightAction } from "./useSpotlightActions";

type StubState = {
  isAdmin: boolean;
  userDetailsPending: boolean;
  scanDirectory: string | undefined;
  searchOptions: SearchOption[];
};

const stubs = vi.hoisted(() => {
  const state: StubState = { isAdmin: false, userDetailsPending: false, scanDirectory: "/photos", searchOptions: [] };
  return {
    navigate: vi.fn<(options: { to: string }) => void>(),
    scan: vi.fn<() => void>(),
    rescan: vi.fn<() => void>(),
    scanDirectoryRequired: vi.fn<() => void>(),
    showNotification: vi.fn<(notification: { message: string }) => void>(),
    ...state,
  };
});

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => stubs.navigate }));
vi.mock("@mantine/notifications", () => ({ showNotification: stubs.showNotification }));
vi.mock("../../api_client/api", () => ({ fetchClient: { get: vi.fn<(endpoint: string) => Promise<unknown>>() } }));
vi.mock("../../api_client/auth", () => ({
  useAccessToken: () => ({ data: { access: { user_id: "1", is_admin: stubs.isAdmin } } }),
}));
vi.mock("../../api_client/faces", () => ({
  useTrainFacesMutation: () => ({ mutate: vi.fn<(...args: unknown[]) => void>() }),
}));
vi.mock("../../api_client/jobs/hooks", () => ({
  useWorkerQuery: () => ({ data: { queue_can_accept_job: true } }),
  useScanPhotosMutation: () => ({ mutate: stubs.scan }),
  useRescanPhotosMutation: () => ({ mutate: stubs.rescan }),
  useGenerateAutoAlbumsMutation: () => ({ mutate: vi.fn<(...args: unknown[]) => void>() }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () =>
    stubs.userDetailsPending
      ? { data: undefined, isPending: true }
      : { data: { scan_directory: stubs.scanDirectory }, isPending: false },
}));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock("../../service/notifications", () => ({
  notification: { scanDirectoryRequired: stubs.scanDirectoryRequired },
}));
vi.mock("../../service/use-search", async importOriginal => ({
  ...(await importOriginal<typeof import("../../service/use-search")>()),
  useSearch: () => ({
    options: stubs.searchOptions,
    filterOptions: vi.fn<(...args: unknown[]) => void>(),
    isLoading: false,
  }),
}));

type Result = ReturnType<typeof useSpotlightActions>;

let result: Result;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let query = "";

function Harness() {
  result = useSpotlightActions(query);
  return null;
}

async function render(defaultColorScheme: MantineColorScheme = "light") {
  await act(async () => {
    root.render(
      <MantineProvider defaultColorScheme={defaultColorScheme}>
        <Harness />
      </MantineProvider>
    );
  });
}

const allActions = (): SpotlightAction[] => result.actions.flatMap(group => group.actions);
const action = (id: string) => allActions().find(entry => entry.id === id);
const requireAction = (id: string) => {
  const found = action(id);
  if (!found) throw new Error(`the palette has no ${id} action`);
  return found;
};
// The component the icon is drawn with
const themeIcon = () => {
  const icon = requireAction("quick-toggle-theme").leftSection;
  return React.isValidElement(icon) ? icon.type : undefined;
};
const trigger = async (id: string) => {
  await act(async () => requireAction(id).onClick());
};

let osDark = false;

beforeAll(() => {
  // jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: osDark && query === "(prefers-color-scheme: dark)",
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  stubs.isAdmin = false;
  stubs.userDetailsPending = false;
  stubs.scanDirectory = "/photos";
  stubs.searchOptions = [];
  query = "";
  osDark = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Delete Missing Photos", () => {
  it("opens a confirmation instead of starting the job", async () => {
    await render();
    expect(result.deleteMissingConfirm.opened).toBe(false);

    await trigger("action-delete-missing");
    expect(result.deleteMissingConfirm.opened).toBe(true);

    await act(async () => result.deleteMissingConfirm.close());
    expect(result.deleteMissingConfirm.opened).toBe(false);
  });
});

describe("scanning", () => {
  it("scans when a scan directory is set", async () => {
    await render();
    await trigger("action-scan");
    await trigger("action-rescan");

    expect(stubs.scan).toHaveBeenCalledTimes(1);
    expect(stubs.rescan).toHaveBeenCalledTimes(1);
  });

  it("tells a user without a scan directory to ask an admin", async () => {
    stubs.scanDirectory = "";
    await render();
    await trigger("action-scan");

    expect(stubs.scan).not.toHaveBeenCalled();
    expect(stubs.scanDirectoryRequired).toHaveBeenCalled();
  });

  it("sends an admin without a scan directory to the Library page and says why", async () => {
    stubs.scanDirectory = "";
    stubs.isAdmin = true;
    await render();
    await trigger("action-rescan");

    expect(stubs.rescan).not.toHaveBeenCalled();
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/library" });
    expect(stubs.showNotification).toHaveBeenCalledWith(
      expect.objectContaining({ message: i18n.t("toasts.scan_directory_setup") })
    );
  });

  it("does nothing while the user details are still loading", async () => {
    stubs.userDetailsPending = true;
    stubs.isAdmin = true;
    await render();
    await trigger("action-scan");

    expect(stubs.scan).not.toHaveBeenCalled();
    expect(stubs.navigate).not.toHaveBeenCalled();
    expect(stubs.showNotification).not.toHaveBeenCalled();
    expect(stubs.scanDirectoryRequired).not.toHaveBeenCalled();
  });
});

describe("navigation", () => {
  it("offers the admin area to admins only", async () => {
    await render();
    expect(action("nav-admin")).toBeUndefined();

    stubs.isAdmin = true;
    await render();
    expect(action("nav-admin")).toBeDefined();
  });

  it("encodes search terms", async () => {
    stubs.searchOptions = [{ value: "what? #1/2", type: SearchOptionType.EXAMPLE, data: "what? #1/2" }];
    await render();
    await trigger("search-0-what? #1/2");

    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/search/what%3F%20%231%2F2" });
  });
});

describe("grouping", () => {
  const groups = () => result.actions;
  const searchGroup = () => {
    const found = groups().find(group => group.group === i18n.t("spotlight.groups.search"));
    if (!found) throw new Error("the palette has no search group");
    return found;
  };

  beforeEach(() => {
    stubs.searchOptions = Array.from({ length: 10 }, (_, i) => ({
      value: `Album ${i}`,
      type: SearchOptionType.USER_ALBUM,
      data: String(i),
    }));
  });

  it("leads with a few suggestions and keeps the commands when nothing is typed", async () => {
    await render();

    expect(searchGroup().actions).toHaveLength(3);
    expect(groups().map(group => group.group)).toEqual(
      expect.arrayContaining([i18n.t("spotlight.groups.navigation"), i18n.t("spotlight.groups.actions")])
    );
  });

  it("offers every match once something is typed", async () => {
    query = "album";
    await render();

    // "Search for" plus the ten matches
    expect(searchGroup().actions).toHaveLength(11);
  });
});

describe("quick actions", () => {
  it("offers light mode when the auto theme follows a dark OS", async () => {
    osDark = true;
    await render("auto");
    expect(themeIcon()).toBe(IconSun);
  });

  it("offers dark mode on the light theme", async () => {
    osDark = true;
    await render("light");
    expect(themeIcon()).toBe(IconMoon);
  });
});
