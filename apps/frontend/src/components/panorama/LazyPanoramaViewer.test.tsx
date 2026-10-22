import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LazyPanoramaViewer } from "./LazyPanoramaViewer";
import type { PanoramaViewerProps } from "./PanoramaViewer";

vi.mock("./PanoramaViewer", () => ({
  PanoramaViewer: ({ src }: PanoramaViewerProps) => <div data-testid="viewer">{src}</div>,
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
});

describe("LazyPanoramaViewer", () => {
  it("loads the viewer on first use and hands it the photo", async () => {
    const container = document.createElement("div");
    await act(async () => {
      createRoot(container).render(
        <MantineProvider env="test">
          <LazyPanoramaViewer src="/media/photos/abc" label="Beach" onLoadFailed={() => {}} />
        </MantineProvider>
      );
    });
    // The dynamic import settles after the first render.
    await act(() => vi.dynamicImportSettled());

    expect(container.querySelector('[data-testid="viewer"]')?.textContent).toBe("/media/photos/abc");
  });
});
