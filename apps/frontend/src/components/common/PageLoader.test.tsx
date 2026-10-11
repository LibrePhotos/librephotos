import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { PageLoader } from "./PageLoader";

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

describe("PageLoader", () => {
  it("renders one centred loader named for assistive technology", async () => {
    await render(<PageLoader />);

    const status = container.querySelectorAll("[role=status]");
    expect(status).toHaveLength(1);
    expect(status[0]?.getAttribute("aria-label")).toBe(i18n.t("loading"));
    expect(status[0]?.classList.contains("mantine-Center-root")).toBe(true);
    expect(container.querySelectorAll(".mantine-Loader-root")).toHaveLength(1);
  });

  it("shows a given label under the spinner and uses it as the name", async () => {
    await render(<PageLoader label="Loading stacks..." />);

    const status = container.querySelector("[role=status]");
    expect(status?.getAttribute("aria-label")).toBe("Loading stacks...");
    expect(status?.textContent).toBe("Loading stacks...");
  });
});
