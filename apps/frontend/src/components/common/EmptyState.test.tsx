/**
 * The scan progress line is one translatable, pluralised string
 * (emptystate.scanning.progress): hardcoded English or a dropped `count`
 * (which shows the raw key) would slip through without this.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { EmptyState } from "./EmptyState";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
}));

let root: Root;
let container: HTMLDivElement;

const render = async (element: React.ReactNode) => {
  await act(async () => {
    root.render(<MantineProvider>{element}</MantineProvider>);
  });
};

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
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("EmptyState scan progress", () => {
  it("shows the processed count out of the target", async () => {
    await render(<EmptyState title="Scanning" description="" progress={{ current: 3, target: 10 }} />);

    expect(container.textContent).toContain("3 / 10 items processed");
  });

  it("uses the singular for a single item", async () => {
    await render(<EmptyState title="Scanning" description="" progress={{ current: 1, target: 1 }} />);

    expect(container.textContent).toContain("1 / 1 item processed");
    expect(container.textContent).not.toContain("emptystate.");
  });
});
