/**
 * The protected shell sends a signed-out visitor to /login?redirect=<path>, but
 * the login page ignored it and always landed on "/", so a shared link or a
 * bookmark lost its page behind the sign-in. The target must stay on this
 * origin: a crafted login link must not forward the user to another site.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { safeRedirect } from "./login";

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  validateSearch: undefined as ((search: Record<string, unknown>) => { redirect?: string }) | undefined,
  search: {} as { redirect?: string },
  isAuthenticated: false,
  login: vi.fn(),
  loginOptions: vi.fn(),
  navigateProps: vi.fn(),
  noopMutation: { mutate: () => {}, isPending: false },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component?: React.ComponentType; validateSearch?: any }) => {
    stubs.component = options.component;
    stubs.validateSearch = options.validateSearch;
    return { useSearch: () => stubs.search };
  },
  Navigate: (props: Record<string, unknown>) => {
    stubs.navigateProps(props);
    return null;
  },
  useNavigate: () => () => {},
}));
vi.mock("@tanstack/react-query", async importOriginal => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}));
vi.mock("../api_client/auth", () => ({
  useIsAuthenticatedQuery: () => ({ data: stubs.isAuthenticated }),
  useIsFirstTimeSetupQuery: () => ({ data: false, isLoading: false }),
  // The hook navigates after a successful sign-in; the page only tells it where.
  useLoginMutation: (options: unknown) => {
    stubs.loginOptions(options);
    return { mutate: stubs.login, isPending: false };
  },
  useSignUpMutation: () => stubs.noopMutation,
  useSsoConfigQuery: () => ({ data: { enabled: false, providers: [] } }),
}));
vi.mock("../api_client/jobs", () => ({ useScanPhotosMutation: () => stubs.noopMutation }));
vi.mock("../api_client/settings", () => ({
  useGetSettingsQuery: () => ({ data: { allow_registration: false, email_configured: false } }),
}));
vi.mock("../api_client/settings/hooks/useUpdateSettingsMutation", () => ({
  useUpdateSettingsMutation: () => stubs.noopMutation,
}));
vi.mock("../api_client/user/hooks", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: undefined }),
  UserListQueryKeys: ["users"],
  useUpdateUserScanDirectoryMutation: () => stubs.noopMutation,
}));
vi.mock("../components/setup/DirectoryPicker", () => ({ DirectoryPicker: () => null }));
vi.mock("../util/apiErrors", () => ({ reportSignupError: () => {}, reportUserSaveError: () => {} }));

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

beforeAll(async () => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.search = {};
  stubs.isAuthenticated = false;
  stubs.login.mockReset();
  stubs.loginOptions.mockReset();
  stubs.navigateProps.mockReset();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});

async function renderLogin() {
  const Login = stubs.component!;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MantineProvider>
        <Login />
      </MantineProvider>
    );
  });
}

describe("safeRedirect", () => {
  it.each(["/", "/photos", "/person/3?tab=faces", "/search?q=beach#top"])("keeps the same-origin path %s", path => {
    expect(safeRedirect(path)).toBe(path);
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "/\t/evil.example/",
    "javascript:alert(1)",
    "photos",
    "/login",
    "/login?redirect=/photos",
    "",
    undefined,
    42,
  ])("drops %s", value => {
    expect(safeRedirect(value)).toBeUndefined();
  });

  it("is what the route's search validator applies", () => {
    expect(stubs.validateSearch!({ redirect: "/albums" })).toEqual({ redirect: "/albums" });
    expect(stubs.validateSearch!({ redirect: "//evil.example" })).toEqual({ redirect: undefined });
  });
});

describe("login redirect", () => {
  it("returns to the page that sent the visitor to the login", async () => {
    stubs.search = { redirect: "/person/3?tab=faces" };
    await renderLogin();

    expect(stubs.loginOptions).toHaveBeenLastCalledWith({ redirectTo: "/person/3?tab=faces" });
  });

  it("goes to the start page without a redirect", async () => {
    await renderLogin();

    expect(stubs.loginOptions).toHaveBeenLastCalledWith({ redirectTo: "/" });
  });

  it("forwards an already signed-in visitor to the target", async () => {
    stubs.isAuthenticated = true;
    stubs.search = { redirect: "/albums" };
    await renderLogin();

    expect(stubs.navigateProps).toHaveBeenCalledWith(expect.objectContaining({ href: "/albums", replace: true }));
  });
});
