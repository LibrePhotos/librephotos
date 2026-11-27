import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { DemoBadge } from "./DemoBadge";

type Settings = { demo_site: boolean; demo_username: string; demo_password: string } | undefined;

const stubs = vi.hoisted(() => ({ settings: undefined as Settings }));

vi.mock("../../api_client/settings", () => ({ useGetSettingsQuery: () => ({ data: stubs.settings }) }));

const unmounts: Array<() => void> = [];

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

afterEach(() => {
  unmounts.splice(0).forEach(unmount => unmount());
});

function render(settings: Settings): HTMLElement {
  stubs.settings = settings;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <MantineProvider env="test">
        <DemoBadge />
      </MantineProvider>
    )
  );
  unmounts.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

const badge = (host: HTMLElement) => host.querySelector(".mantine-Badge-root");

describe("DemoBadge", () => {
  it("says the site is a view-only demo", () => {
    const host = render({ demo_site: true, demo_username: "demo", demo_password: "demo1234" });

    expect(badge(host)?.textContent).toBe("Demo, view only");
  });

  it("is not there on a normal server or while the settings load", () => {
    expect(badge(render({ demo_site: false, demo_username: "", demo_password: "" }))).toBeNull();
    expect(badge(render(undefined))).toBeNull();
  });
});
