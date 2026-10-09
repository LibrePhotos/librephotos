import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { TopMenuPublic } from "./TopMenuPublic";

type Session = { isAuthenticated: boolean; user?: { username: string }; isLoading?: boolean };

const stubs = vi.hoisted(() => ({
  session: { isAuthenticated: false } as Session,
  navigate: vi.fn(),
  userQuerySkips: [] as boolean[],
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => stubs.navigate,
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("../../api_client/auth", () => ({
  useIsAuthenticatedQuery: () => ({ data: stubs.session.isAuthenticated }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: (skip: boolean) => {
    stubs.userQuerySkips.push(skip);
    return { data: stubs.session.user, isLoading: !!stubs.session.isLoading };
  },
}));
vi.mock("./ProfileButton", () => ({
  ProfileButton: () => <button type="button">account</button>,
}));

let root: Root;
let container: HTMLDivElement;

const render = async (session: Session) => {
  stubs.session = session;
  await act(async () => {
    root.render(
      <MantineProvider>
        <TopMenuPublic />
      </MantineProvider>
    );
  });
};

const buttons = () => [...container.querySelectorAll("button")];

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
  stubs.navigate.mockClear();
  stubs.userQuerySkips = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("TopMenuPublic", () => {
  it("offers visitors the login", async () => {
    await render({ isAuthenticated: false });

    // No cookie, no request for the user.
    expect(stubs.userQuerySkips.every(Boolean)).toBe(true);
    const login = buttons().find(button => button.textContent === i18n.t("login.login"))!;
    expect(login).toBeDefined();
    expect(container.textContent).not.toContain("account");
    await act(async () => login.click());
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/login" });
  });

  it("offers a signed-in owner the way back and the account menu instead", async () => {
    await render({ isAuthenticated: true, user: { username: "admin" } });

    expect(container.textContent).not.toContain(i18n.t("login.login"));
    expect(container.textContent).toContain("account");
    const home = buttons().find(button => button.textContent === i18n.t("publicalbum.goHome"))!;
    await act(async () => home.click());
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("offers the login when the cookie is left over from an expired session", async () => {
    // The user request failed (401): the server no longer knows this visitor.
    await render({ isAuthenticated: true, user: undefined });

    expect(container.textContent).toContain(i18n.t("login.login"));
    expect(container.textContent).not.toContain("account");
    expect(container.textContent).not.toContain(i18n.t("publicalbum.goHome"));
  });

  it("shows neither while the session is being checked", async () => {
    await render({ isAuthenticated: true, isLoading: true });

    expect(buttons()).toHaveLength(0);
  });
});
