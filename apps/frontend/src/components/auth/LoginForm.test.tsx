/**
 * "Remember me" on the login page (#2024): a checkbox in the password form, offered when the
 * server sends a day count, whose choice goes along with the credentials. It shares a row with
 * "Forgot your password?", and says what it does only while it is ticked.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { LoginForm } from "./LoginForm";

type Credentials = { username: string; password: string; remember_me?: boolean };
type Settings = { remember_me_days?: number; email_configured?: boolean };
type SsoConfig = { enabled: boolean; label: string; providers: { id: string; name: string; login_url: string }[] };

const stubs = vi.hoisted(() => {
  const settings: { current: Settings | undefined } = { current: undefined };
  const sso: { current: SsoConfig | undefined } = { current: undefined };
  return { login: vi.fn<(credentials: Credentials) => void>(), settings, sso };
});

vi.mock("@tanstack/react-router", () => ({ Navigate: () => null }));
vi.mock("../../api_client/auth", () => ({
  useIsAuthenticatedQuery: () => ({ data: false }),
  useLoginMutation: () => ({ mutate: stubs.login, isPending: false }),
  useSsoConfigQuery: () => ({ data: stubs.sso.current }),
}));
vi.mock("../../api_client/settings", () => ({
  useGetSettingsQuery: () => ({ data: stubs.settings.current }),
}));

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;

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
});

beforeEach(() => {
  stubs.login.mockReset();
  stubs.settings.current = { remember_me_days: 30, email_configured: true };
  stubs.sso.current = undefined;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

function render(): HTMLDivElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  container = host;
  root = createRoot(host);
  act(() =>
    root?.render(
      <MantineProvider env="test">
        <LoginForm />
      </MantineProvider>
    )
  );
  return host;
}

function checkbox(host: HTMLElement): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('input[name="remember_me"]');
}

function submit(host: HTMLElement): Credentials {
  act(() => {
    defined(host.querySelector("form")).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(stubs.login).toHaveBeenCalledTimes(1);
  return defined(stubs.login.mock.calls[0])[0];
}

describe("LoginForm: Remember me", () => {
  it("is off by default and signs in with session cookies", () => {
    const host = render();

    expect(defined(checkbox(host)).checked).toBe(false);
    expect(host.textContent).not.toContain("Stay signed in");
    expect(submit(host).remember_me).toBe(false);
  });

  it("asks for a long sign-in when ticked and says for how long", () => {
    const host = render();
    const box = defined(checkbox(host));

    act(() => box.click());

    expect(box.checked).toBe(true);
    expect(host.textContent).toContain(
      "Stay signed in on this browser for 30 days. Leave it off on a shared computer."
    );
    const hint = defined(box.getAttribute("aria-describedby"));
    expect(document.getElementById(hint)?.textContent).toContain("30 days");
    expect(submit(host).remember_me).toBe(true);
  });

  it("says day, not days, for one day", () => {
    stubs.settings.current = { remember_me_days: 1 };
    const host = render();

    act(() => defined(checkbox(host)).click());

    expect(host.textContent).toContain("for 1 day.");
  });

  it("is not offered when the server turns it off or does not know it", () => {
    for (const settings of [{ remember_me_days: 0, email_configured: true }, { email_configured: true }]) {
      stubs.settings.current = settings;
      stubs.login.mockReset();
      const host = render();

      expect(checkbox(host)).toBeNull();
      expect(host.textContent).toContain("Forgot your password?");
      expect(submit(host)).not.toHaveProperty("remember_me");
      act(() => root?.unmount());
      host.remove();
    }
  });

  it("shares the row with Forgot your password? only when e-mail is configured", () => {
    stubs.settings.current = { remember_me_days: 30, email_configured: false };
    const host = render();

    expect(checkbox(host)).not.toBeNull();
    expect(host.textContent).not.toContain("Forgot your password?");
  });

  it("leaves the row out when there is neither", () => {
    stubs.settings.current = undefined;
    const host = render();

    expect(checkbox(host)).toBeNull();
    expect(host.textContent).not.toContain("Forgot your password?");
  });

  it("sits in the password form, above the single sign-on buttons", () => {
    stubs.sso.current = {
      enabled: true,
      label: "",
      providers: [{ id: "kc", name: "Keycloak", login_url: "/accounts/oidc/kc/login/" }],
    };
    const host = render();

    const form = defined(host.querySelector("form"));
    expect(form.contains(checkbox(host))).toBe(true);
    const sso = defined(host.querySelector('a[href="/accounts/oidc/kc/login/"]'));
    expect(form.contains(sso)).toBe(false);
  });
});
