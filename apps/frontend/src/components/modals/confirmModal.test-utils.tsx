import { createTheme, MantineProvider } from "@mantine/core";
import React, { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

/** jsdom ships no matchMedia (MantineProvider) or ResizeObserver (ScrollArea, Select). Call in beforeAll. */
export function setUpMantineDom(): void {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
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
}

// No open/close animation, so a closed dialog is gone at once.
const theme = createTheme({ components: { Modal: { defaultProps: { transitionProps: { duration: 0 } } } } });

/** Render `ui` inside a MantineProvider; `rerender` swaps it for new props. */
export async function renderInMantine(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const rerender = async (next: ReactNode) => {
    await act(async () => {
      root.render(<MantineProvider theme={theme}>{next}</MantineProvider>);
    });
  };
  await rerender(ui);
  return { container, rerender };
}

/** The topmost open dialog, wherever Mantine portalled it; null while none is open. */
export function openDialog(): HTMLElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return dialogs[dialogs.length - 1] ?? null;
}

/** A button whose text is `label`, in the topmost open dialog. Throws when there is none. */
export function dialogButton(label: string): HTMLButtonElement {
  const dialog = openDialog();
  if (!dialog) {
    throw new Error("no dialog is open");
  }
  const button = [...dialog.querySelectorAll("button")].find(candidate => candidate.textContent?.trim() === label);
  if (!button) {
    throw new Error(`no "${label}" button in the dialog`);
  }
  return button;
}

/** Click `element` inside act(). */
export async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
}
