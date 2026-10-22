import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

/** Render `node` in Mantine (test env) for the your-places component tests (#1365). */
export async function renderPlaces(node: React.ReactNode) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no matchMedia; Mantine and useMediaQuery ask it
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // SegmentedControl and ScrollArea measure themselves; jsdom has no ResizeObserver
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MantineProvider env="test">{node}</MantineProvider>);
  });
  /** The button whose text or accessible name is `name`, anywhere in the document (portals too). */
  const button = (name: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      element => element.textContent?.trim() === name || element.getAttribute("aria-label") === name
    );
  return {
    container,
    text: () => container.textContent ?? "",
    button,
    async click(element: HTMLElement | undefined) {
      if (!element) throw new Error("nothing to click");
      await act(async () => {
        element.click();
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}
