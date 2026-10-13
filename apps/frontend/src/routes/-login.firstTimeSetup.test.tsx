/**
 * The first-run setup creates the admin account on /login. Its form refuses an invalid e-mail
 * address and passwords that differ before anything is sent.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { defined } from "../util/defined.test-utils";

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  signup: vi.fn<(variables: Record<string, string>, options: { onSuccess?: () => void }) => void>(),
  login: vi.fn<(variables: unknown, options: { onSuccess?: () => void }) => void>(),
  updateSettings: vi.fn<(variables: unknown, options: { onSuccess?: () => void; onError?: () => void }) => void>(),
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
  useLoginMutation: () => ({ mutate: stubs.login, isPending: false }),
  useSignUpMutation: () => ({ mutate: stubs.signup, isPending: false }),
  useSsoConfigQuery: () => ({ data: { enabled: false, providers: [] } }),
}));
vi.mock("../api_client/jobs", () => ({ useScanPhotosMutation: () => stubs.noopMutation }));
// One object, as React Query hands back the same data until it changes: a new one per render
// would put the wizard's switches back on every render.
const SITE_SETTINGS = { allow_registration: false, allow_upload: false, email_configured: false };
vi.mock("../api_client/settings", () => ({
  useGetSettingsQuery: () => ({ data: SITE_SETTINGS }),
}));
vi.mock("../api_client/settings/hooks/useUpdateSettingsMutation", () => ({
  useUpdateSettingsMutation: () => ({ mutate: stubs.updateSettings, isPending: false }),
}));
vi.mock("../api_client/user/hooks", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: undefined }),
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
  stubs.login.mockReset();
  stubs.updateSettings.mockReset();
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

  // #695: the hand-written pattern refused these (upper-case TLD, one-letter label, two hyphens).
  it.each(["John@Example.COM", "a@b.co", "x@my-long-domain.example.org"])("accepts %s", async email => {
    await renderSetup();
    await fillAndSubmit({ ...ADMIN, email });

    expect(stubs.signup).toHaveBeenCalledWith(expect.objectContaining({ email }), expect.anything());
  });
});

// #2224: step 2 moved on to the scan directory even when saving the site settings failed, so a
// refused allow_upload / allow_registration was skipped without a word. The QueryClient toasts
// the failure; the wizard has to stay on the step so the admin can try again.
describe("the site settings step of the first-run setup", () => {
  async function reachSiteSettingsStep() {
    stubs.signup.mockImplementation((_variables, options) => options.onSuccess?.());
    stubs.login.mockImplementation((_variables, options) => options.onSuccess?.());
    await renderSetup();
    await fillAndSubmit(ADMIN);
  }

  const button = (label: string) =>
    defined([...container.querySelectorAll("button")].find(b => b.textContent === label));
  const uploadSwitch = () => {
    const label = defined(
      [...container.querySelectorAll("label")].find(l => l.textContent === i18n.t("sitesettings.headerupload"))
    );
    return defined(container.querySelector<HTMLInputElement>(`#${CSS.escape(label.htmlFor)}`));
  };

  it("stays on the step when saving fails", async () => {
    stubs.updateSettings.mockImplementation((_variables, options) => options.onError?.());
    await reachSiteSettingsStep();

    await act(async () => uploadSwitch().click());
    await act(async () => button(i18n.t("continue")).click());

    expect(stubs.updateSettings).toHaveBeenCalledWith(
      { allow_upload: true, allow_registration: false },
      expect.anything()
    );
    // Still the site settings step: its switches are there, the directory step is not.
    expect(uploadSwitch().checked).toBe(true);
    expect(button(i18n.t("continue"))).toBeDefined();
    expect(container.textContent).not.toContain(i18n.t("skip"));
  });

  it("moves on once the save went through", async () => {
    stubs.updateSettings.mockImplementation((_variables, options) => options.onSuccess?.());
    await reachSiteSettingsStep();

    await act(async () => uploadSwitch().click());
    await act(async () => button(i18n.t("continue")).click());

    expect(container.textContent).toContain(i18n.t("skip"));
  });
});
