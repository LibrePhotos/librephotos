/**
 * Repro for https://github.com/LibrePhotos/librephotos/issues/924
 *
 *   "Allow remembering credentials on login page"
 *   -> "webapp is the only alternative, but it keeps logging off sessions from time to
 *      time forcing users to sign in again."
 *
 * Browsers already offer to remember credentials, but only for forms they can
 * recognize. The HTML spec's autofill detail tokens (`autocomplete="username"` /
 * `autocomplete="current-password"`) are what tells a password manager which field is
 * which and that the pair is a sign-in, not a sign-up or a password change. Chrome,
 * Safari and Firefox all fall back to fragile heuristics without them, and the
 * heuristics are exactly what breaks on a single-page app where the login form is
 * mounted by client-side routing rather than being present in the served document.
 *
 * The login form (src/routes/login.tsx) rendered its username and password fields with
 * `name` attributes only, so nothing on the page declared the credential roles.
 *
 * This test renders the real login page and asserts the three things a password manager
 * needs: a `<form>` that submits, a username field tagged `autocomplete="username"`, and
 * a password field tagged `autocomplete="current-password"`.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";

const stubs = vi.hoisted(() => ({
  login: vi.fn(),
  noopMutation: { mutate: () => {}, isPending: false },
  component: undefined as React.ComponentType | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => {
    // The route module hands its page component to createFileRoute's options.
    const route = (options?: { component?: React.ComponentType }) => {
      stubs.component = options?.component;
      return route;
    };
    return route;
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
  useIsFirstTimeSetupQuery: () => ({ data: false, isLoading: false }),
  useLoginMutation: () => ({ mutate: stubs.login, isPending: false }),
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
  // Pay for the cold import of the route module here, under a generous hook
  // timeout, rather than inside the first test's 5 s budget: under full-suite
  // load it alone can take longer than that.
  await import("../routes/login");
}, 30_000);

async function renderLoginPage() {
  // The route component renders the sign-in form when this is not a first-time setup,
  // which the useIsFirstTimeSetupQuery mock above guarantees.
  await import("../routes/login");
  const LoginPage = stubs.component!;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <LoginPage />
      </MantineProvider>
    );
  });
  return {
    container,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("issue #924 - browsers cannot offer to remember the login credentials", () => {
  it("marks the sign-in fields with the autofill tokens a password manager looks for", async () => {
    const { container, cleanup } = await renderLoginPage();

    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    const username = form!.querySelector<HTMLInputElement>('input[name="username"]');
    const password = form!.querySelector<HTMLInputElement>('input[name="password"]');
    expect(username).not.toBeNull();
    expect(password).not.toBeNull();

    expect(password!.type).toBe("password");
    expect(username!.getAttribute("autocomplete")).toBe("username");
    expect(password!.getAttribute("autocomplete")).toBe("current-password");

    await cleanup();
  });

  it("submits through the form so the browser sees a credential submission", async () => {
    const { container, cleanup } = await renderLoginPage();
    const form = container.querySelector("form")!;

    const username = form.querySelector<HTMLInputElement>('input[name="username"]')!;
    const password = form.querySelector<HTMLInputElement>('input[name="password"]')!;

    // A submit button inside the form, not a bare onClick handler: browsers treat the
    // form's submit event as the signal that credentials were used.
    expect(form.querySelector('button[type="submit"]')).not.toBeNull();

    stubs.login.mockClear();
    await act(async () => {
      username.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(username, "Alice");
      username.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(password, "hunter2");
      password.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(stubs.login).toHaveBeenCalledWith({ username: "alice", password: "hunter2" });

    await cleanup();
  });
});
