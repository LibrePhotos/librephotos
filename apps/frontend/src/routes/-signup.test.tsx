/**
 * The sign-up page failed silently: a taken username or a refused password did
 * nothing, a sign-up refused because registration is off reloaded the form into
 * the login page, and a successful one landed on the login page without a word.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api_client/api";
import i18n from "../i18n";

type MutateOptions = { onSuccess?: () => void; onError?: (error: unknown) => void };

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  signup: vi.fn(),
  login: vi.fn(),
  reportSignupError: vi.fn(),
  signupError: vi.fn(),
  settings: { allow_registration: true } as { allow_registration: boolean } | undefined,
}));

vi.mock("@tanstack/react-router", async () => {
  const { forwardRef, createElement } = await import("react");
  return {
    createFileRoute: () => (options?: { component?: React.ComponentType }) => {
      stubs.component = options?.component;
      return {};
    },
    Link: forwardRef<HTMLAnchorElement, { to: string; children?: React.ReactNode }>(({ to, ...rest }, ref) =>
      createElement("a", { ref, href: to, ...rest })
    ),
  };
});
vi.mock("../api_client/auth", () => ({
  useSignUpMutation: () => ({ mutate: stubs.signup, isPending: false }),
  useLoginMutation: () => ({ mutate: stubs.login, isPending: false }),
}));
vi.mock("../api_client/settings", () => ({ useGetSettingsQuery: () => ({ data: stubs.settings }) }));
vi.mock("../util/apiErrors", () => ({ reportSignupError: stubs.reportSignupError }));
vi.mock("../service/notifications", () => ({ notification: { signupError: stubs.signupError } }));

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
  await import("./signup");
}, 30_000);

beforeEach(() => {
  stubs.signup.mockReset();
  stubs.login.mockReset();
  stubs.reportSignupError.mockReset();
  stubs.signupError.mockReset();
  stubs.settings = { allow_registration: true };
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});

async function renderPage() {
  const SignupPage = stubs.component!;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MantineProvider env="test">
        <SignupPage />
      </MantineProvider>
    );
  });
}

async function fillAndSubmit() {
  const values: Record<string, string> = {
    username: "Alice",
    email: "alice@example.com",
    firstname: "Alice",
    lastname: "Liddell",
    password: "wonderland",
    passwordConfirm: "wonderland",
  };
  const form = container.querySelector("form")!;
  await act(async () => {
    Object.entries(values).forEach(([name, value]) => {
      const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  return stubs.signup.mock.calls[0]?.[1] as MutateOptions;
}

describe("the sign-up page", () => {
  it("signs the new user straight in", async () => {
    await renderPage();
    const options = await fillAndSubmit();

    expect(stubs.signup).toHaveBeenCalledWith(
      {
        email: "alice@example.com",
        first_name: "Alice",
        last_name: "Liddell",
        username: "alice",
        password: "wonderland",
      },
      expect.anything()
    );
    await act(async () => options.onSuccess!());
    expect(stubs.login).toHaveBeenCalledWith({ username: "alice", password: "wonderland" });
  });

  it("reports a rejected sign-up", async () => {
    await renderPage();
    const options = await fillAndSubmit();
    const taken = new ApiError("Bad Request", 400, "A user with that username already exists.");

    await act(async () => options.onError!(taken));

    expect(stubs.reportSignupError).toHaveBeenCalledWith(taken);
  });

  it("says registration is off when the server refuses an anonymous sign-up", async () => {
    await renderPage();
    const options = await fillAndSubmit();

    await act(async () => options.onError!(new ApiError("Authentication failed", 401)));

    expect(stubs.signupError).toHaveBeenCalledWith(i18n.t("login.registrationdisabled"));
    expect(stubs.reportSignupError).not.toHaveBeenCalled();
  });

  it("shows a notice instead of the form when registration is off", async () => {
    stubs.settings = { allow_registration: false };
    await renderPage();

    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain(i18n.t("login.registrationdisabled"));
    expect(container.querySelector('a[href="/login"]')?.textContent).toBe(i18n.t("passwordreset.backtologin"));
  });

  it("marks both password fields as required", async () => {
    await renderPage();

    expect(container.querySelector<HTMLInputElement>('input[name="password"]')!.required).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="passwordConfirm"]')!.required).toBe(true);
  });
});
