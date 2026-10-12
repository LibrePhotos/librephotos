/**
 * The two password-reset forms: the request (an e-mail address) and the new password from the
 * link (typed twice). Each refuses what it can tell is wrong before anything is sent.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PasswordResetError } from "../api_client/auth/passwordResetErrors";
import i18n from "../i18n";
import { defined } from "../util/defined.test-utils";

type MutateOptions = { onSuccess?: () => void; onError?: (error: unknown) => void };

const stubs = vi.hoisted(() => ({
  components: {} as Record<string, React.ComponentType | undefined>,
  requestReset: vi.fn<(variables: { email: string }, options: MutateOptions) => void>(),
  confirmReset:
    vi.fn<(variables: { uid: string; token: string; new_password: string }, options: MutateOptions) => void>(),
  passwordResetError: vi.fn<(error: unknown) => PasswordResetError>(),
  navigate: vi.fn<(options: { to: string }) => void>(),
  success: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (options?: { component?: React.ComponentType }) => {
    stubs.components[path] = options?.component;
    return { useParams: () => ({ uid: "MQ", token: "set-token" }) };
  },
  useNavigate: () => stubs.navigate,
}));
vi.mock("../api_client/auth", () => ({
  useRequestPasswordResetMutation: () => ({ mutate: stubs.requestReset, isPending: false }),
  useConfirmPasswordResetMutation: () => ({ mutate: stubs.confirmReset, isPending: false }),
}));
vi.mock("../api_client/auth/passwordResetErrors", () => ({ passwordResetError: stubs.passwordResetError }));
vi.mock("../service/notifications", () => ({ notification: { success: stubs.success, error: stubs.error } }));

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
  await import("./password-reset.index");
  await import("./password-reset.confirm.$uid.$token");
}, 30_000);

beforeEach(() => {
  stubs.requestReset.mockReset();
  stubs.confirmReset.mockReset();
  stubs.passwordResetError.mockReset();
  stubs.navigate.mockReset();
  stubs.success.mockReset();
  stubs.error.mockReset();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
});

async function renderRoute(path: string) {
  const Page = stubs.components[path];
  if (!Page) {
    throw new Error(`the route module did not register ${path}`);
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(
      <MantineProvider env="test">
        <Page />
      </MantineProvider>
    );
  });
}

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

describe("requesting a password reset", () => {
  it("sends the address and confirms without saying whether it is registered", async () => {
    await renderRoute("/password-reset/");
    await fillAndSubmit({ email: "alice@example.com" });

    expect(stubs.requestReset).toHaveBeenCalledWith({ email: "alice@example.com" }, expect.anything());
    await act(async () => defined(stubs.requestReset.mock.calls[0])[1].onSuccess?.());
    expect(container.textContent).toContain(i18n.t("passwordreset.checkemail"));
  });

  it("refuses an invalid address without a request", async () => {
    await renderRoute("/password-reset/");
    await fillAndSubmit({ email: "alice@" });

    expect(stubs.requestReset).not.toHaveBeenCalled();
    expect(container.textContent).toContain(i18n.t("passwordreset.erroremail"));
  });

  // #695: the hand-written pattern refused these (upper-case TLD, one-letter label, two hyphens).
  it.each(["John@Example.COM", "a@b.co", "x@my-long-domain.example.org"])("accepts %s", async email => {
    await renderRoute("/password-reset/");
    await fillAndSubmit({ email });

    expect(stubs.requestReset).toHaveBeenCalledWith({ email }, expect.anything());
  });
});

describe("choosing the new password", () => {
  it("sends the new password with the link's uid and token", async () => {
    await renderRoute("/password-reset/confirm/$uid/$token");
    await fillAndSubmit({ password: "wonderland", passwordConfirm: "wonderland" });

    expect(stubs.confirmReset).toHaveBeenCalledWith(
      { uid: "MQ", token: "set-token", new_password: "wonderland" },
      expect.anything()
    );
    await act(async () => defined(stubs.confirmReset.mock.calls[0])[1].onSuccess?.());
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/login" });
  });

  it("refuses passwords that differ without a request", async () => {
    await renderRoute("/password-reset/confirm/$uid/$token");
    await fillAndSubmit({ password: "wonderland", passwordConfirm: "wonderlant" });

    expect(stubs.confirmReset).not.toHaveBeenCalled();
    expect(container.textContent).toContain(i18n.t("passwordreset.errormustmatch"));
  });

  it("shows the server's refusal of a weak password at the field", async () => {
    stubs.passwordResetError.mockReturnValue({ kind: "weakPassword", message: "This password is too common." });
    await renderRoute("/password-reset/confirm/$uid/$token");
    await fillAndSubmit({ password: "password", passwordConfirm: "password" });

    await act(async () => defined(stubs.confirmReset.mock.calls[0])[1].onError?.(new Error("refused")));

    expect(container.textContent).toContain("This password is too common.");
    expect(stubs.error).not.toHaveBeenCalled();
  });
});
