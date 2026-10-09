import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { ColorModeSwitch } from "./ColorModeSwitch";
import { TopMenuLogo } from "./TopMenuLogo";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

let root: Root;
let container: HTMLDivElement;

const mockOsScheme = (dark: boolean) => {
  // @ts-ignore - jsdom has no matchMedia
  window.matchMedia = (query: string) => ({
    matches: dark && query.includes("dark"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
};

const render = async () => {
  await act(async () => {
    root.render(
      // The app's setting: nothing saved yet means "auto", i.e. follow the OS.
      <MantineProvider defaultColorScheme="auto">
        <TopMenuLogo />
        <ColorModeSwitch />
      </MantineProvider>
    );
  });
};

beforeAll(async () => {
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  window.localStorage.removeItem("mantine-color-scheme-value");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("shell colour scheme on the default 'auto' setting", () => {
  it("shows the white logo and the dark state when the OS is dark", async () => {
    mockOsScheme(true);
    await render();

    expect(container.querySelector("img")?.getAttribute("src")).toBe("/logo-white.png");
    expect(container.querySelector(".tabler-icon-moon")).not.toBeNull();
    expect(container.querySelector(".tabler-icon-sun")).toBeNull();
  });

  it("shows the dark logo and the light state when the OS is light", async () => {
    mockOsScheme(false);
    await render();

    expect(container.querySelector("img")?.getAttribute("src")).toBe("/logo.png");
    expect(container.querySelector(".tabler-icon-sun")).not.toBeNull();
  });

  it("names the logo link and the toggle", async () => {
    mockOsScheme(false);
    await render();

    expect(container.querySelector("img")?.getAttribute("alt")).toBe("LibrePhotos");
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Toggle color scheme");
  });
});
