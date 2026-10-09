import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { NotFoundPage, RouteErrorPage } from "./RouteFallbacks";

const stubs = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => stubs.navigate,
}));

let root: Root;
let container: HTMLDivElement;

const render = async (element: React.ReactNode) => {
  await act(async () => {
    root.render(<MantineProvider>{element}</MantineProvider>);
  });
};

const button = (label: string) => [...container.querySelectorAll("button")].find(b => b.textContent === label)!;

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
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("route fallbacks", () => {
  it("explains a missing page in the app's language and leads back home", async () => {
    await render(<NotFoundPage />);

    expect(container.textContent).toContain(i18n.t("routefallback.notfoundtitle"));
    expect(container.textContent).not.toContain("Not Found");
    await act(async () => button(i18n.t("publicalbum.goHome")).click());
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("offers a reload and a way home when a page crashes", async () => {
    await render(<RouteErrorPage error={new Error("boom")} reset={() => {}} />);

    expect(container.textContent).toContain(i18n.t("routefallback.errortitle"));
    expect(button(i18n.t("routefallback.reload"))).toBeDefined();
    expect(button(i18n.t("publicalbum.goHome"))).toBeDefined();
  });
});
