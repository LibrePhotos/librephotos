/**
 * The first-run setup creates the admin account on /login. Its form refuses an invalid e-mail
 * address and passwords that differ before anything is sent.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { defined } from "../util/defined.test-utils";

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  signup: vi.fn<(variables: Record<string, string>, options: unknown) => void>(),
  noopMutation: { mutate: () => {}, isPending: false },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component?: React.ComponentType }) => {
    stubs.component = options.component;
    return { useSearch: () => ({}) };
  },
  Navigate: () => null,
  useNavigate: () => () => {},
}));
vi.mock("@tanstack/react-query", async importOriginal => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}));
vi.mock("../api_client/auth", () => ({
  useIsAuthenticatedQuery: () => ({ data: false }),
  useIsFirstTimeSetupQuery: () => ({ data: true, isLoading: false }),
  useLoginMutation: () => stubs.noopMutation,
  useSignUpMutation: () => ({ mutate: stubs.signup, isPending: false }),
  useSsoConfigQuery: () => ({ data: { enabled: false, providers: [] } }),
}));
vi.mock("../api_client/jobs", () => ({ useScanPhotosMutation: () => stubs.noopMutation }));
vi.mock("../api_client/settings", () => ({
  useGetSettingsQuery: () => ({ data: { allow_registration: false, allow_upload: false, email_configured: false } }),
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
  // jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  await import("./login");
}, 30_000);

beforeEach(() => {
  stubs.signup.mockReset();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});

async function renderSetup() {
  const Login = stubs.component;
  if (!Login) {
    throw new Error("the route module did not register its component");
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(
      <MantineProvider env="test">
        <Login />
      </MantineProvider>
    );
  });
}

const ADMIN: Record<string, string> = {
  username: "Admin",
  email: "admin@example.com",
  firstname: "Ada",
  lastname: "Lovelace",
  password: "analytical",
  passwordConfirm: "analytical",
};

async function fillAndSubmit(values: Record<string, string>) {
  const form = defined(container.querySelector("form"));
  await act(async () => {
    Object.entries(values).forEach(([name, value]) => {
      const input = defined(form.querySelector<HTMLInputElement>(`input[name="${name}"]`));
      defined(defined(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")).set).call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("the first-run setup form", () => {
  it("creates the admin account", async () => {
    await renderSetup();
    await fillAndSubmit(ADMIN);

    expect(stubs.signup).toHaveBeenCalledWith(
      {
        email: "admin@example.com",
        first_name: "Ada",
        last_name: "Lovelace",
        username: "admin",
        password: "analytical",
      },
      expect.anything()
    );
  });

  it("refuses an invalid address and passwords that differ", async () => {
    await renderSetup();
    await fillAndSubmit({ ...ADMIN, email: "admin@", passwordConfirm: "analytic" });

    expect(stubs.signup).not.toHaveBeenCalled();
    expect(container.textContent).toContain(i18n.t("modaluseredit.errorinvalidemail"));
    expect(container.textContent).toContain(i18n.t("settings.password.errormustmatch"));
  });
});
