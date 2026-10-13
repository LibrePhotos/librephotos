import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import type { UploadQueue } from "../upload/useUploadQueue";
import { FooterMenu } from "./FooterMenu";

const stubs = vi.hoisted(() => ({
  logout: vi.fn<() => void>(),
  queue: null as UploadQueue | null,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => vi.fn<(options: { to: string }) => void>(),
}));
vi.mock("../../api_client/auth", () => ({ useLogoutMutation: () => ({ mutate: stubs.logout }) }));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { username: "admin", is_superuser: false } }),
}));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock("../upload/UploadContext", async importOriginal => ({
  ...(await importOriginal<typeof import("../upload/UploadContext")>()),
  useOptionalUpload: () => stubs.queue,
}));

const queue = (isUploading: boolean): UploadQueue => ({
  items: [{ id: "a", file: new File([], "a.jpg"), status: isUploading ? "uploading" : "done", progress: 0 }],
  isUploading,
  isCancelling: false,
  start: vi.fn<UploadQueue["start"]>(),
  retry: vi.fn<UploadQueue["retry"]>(),
  cancel: vi.fn<UploadQueue["cancel"]>(),
  reset: vi.fn<UploadQueue["reset"]>(),
});

let root: Root;
let container: HTMLDivElement;

const logOutFromMenu = async () => {
  await act(async () => {
    root.render(
      // env="test" renders the menu and the dialog inline and without transitions.
      <MantineProvider env="test">
        <FooterMenu />
      </MantineProvider>
    );
  });
  await act(async () =>
    defined(container.querySelector<HTMLButtonElement>('button[aria-label="Account menu"]')).click()
  );
  const logout = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el =>
    el.textContent?.includes("Log out")
  );
  await act(async () => defined(logout).click());
};

beforeAll(async () => {
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
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("FooterMenu log out", () => {
  it("logs out at once when no upload runs", async () => {
    stubs.queue = queue(false);
    await logOutFromMenu();
    expect(stubs.logout).toHaveBeenCalledTimes(1);
  });

  it("asks first while an upload runs", async () => {
    stubs.queue = queue(true);
    await logOutFromMenu();
    expect(stubs.logout).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Log out while uploading?");
  });
});
