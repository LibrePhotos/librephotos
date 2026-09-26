import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNT_STATS_DEFAULTS } from "../api_client/stats/types";
import i18n from "../i18n";
import { CountStats } from "./CountStats";

const stubs = vi.hoisted(() => ({ stats: {} as Record<string, number> }));

vi.mock("../api_client/stats/hooks", () => ({
  useFetchCountStatsQuery: () => ({ data: stubs.stats }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/statistics">{children}</a>,
}));

let root: Root;
let container: HTMLDivElement;

const render = async (stats: Partial<typeof COUNT_STATS_DEFAULTS>) => {
  stubs.stats = { ...COUNT_STATS_DEFAULTS, ...stats };
  await act(async () => {
    root.render(
      <MantineProvider>
        <CountStats />
      </MantineProvider>
    );
  });
};

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

afterAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

const focusableCounts = () => Array.from(container.querySelectorAll<HTMLElement>('[tabindex="0"]'));

describe("CountStats", () => {
  it("shows the full grouped count and a compact one whose exact value screen readers still get", async () => {
    await render({ num_photos: 25123 });
    const text = container.textContent ?? "";
    expect(text).toContain("25,123");
    expect(text).toContain("25.1K");
    const compact = Array.from(container.querySelectorAll('[aria-hidden="true"]')).find(
      el => el.textContent === "25.1K"
    );
    expect(compact?.nextElementSibling?.textContent).toBe("25,123");
  });

  it("does not render a compact variant or tab stop for counts that need no abbreviation", async () => {
    await render({ num_photos: 999, num_albumdate: 12, num_albumauto: 3 });
    expect(container.textContent).toContain("999");
    expect(focusableCounts()).toHaveLength(0);
  });

  it("makes abbreviated counts focusable for the tooltip, except inside the People HoverCard", async () => {
    await render({ num_photos: 25123, num_albumdate: 1200, num_people: 4321, num_faces: 54321, num_albumauto: 1500 });
    const focusable = focusableCounts().map(el => el.textContent);
    // photos, days and events get a tooltip target; people and faces do not
    expect(focusable).toEqual(["25.1K25,123", "1.2K1,200", "1.5K1,500"]);
  });

  it("formats counts in the app language", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    await render({ num_photos: 1500000 });
    const text = container.textContent ?? "";
    expect(text).toContain("1.500.000");
    expect(text).toContain("1,5 Mio.");
  });
});
