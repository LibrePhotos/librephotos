/**
 * The shared map frame (#2232): a skeleton covers the map until its style has loaded, so a map
 * never shows the style's light background first, and a style that fails takes the skeleton
 * away too. A render failure stays inside the frame.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ThemedMap } from "./ThemedMap";

type MapEvent = { type: string; error?: Error };

const map = vi.hoisted(() => ({ throws: false }));

// Stands in for react-map-gl's <Map>: two buttons fire its load and error events.
vi.mock("react-map-gl/maplibre", async () => {
  const react = await import("react");
  return {
    default: (props: {
      children?: React.ReactNode;
      onLoad?: (event: MapEvent) => void;
      onError?: (event: MapEvent) => void;
    }) => {
      if (map.throws) throw new Error("WebGL context lost");
      return react.createElement(
        "div",
        { "data-testid": "map" },
        react.createElement("button", {
          type: "button",
          "data-testid": "load",
          onClick: () => props.onLoad?.({ type: "load" }),
        }),
        react.createElement("button", {
          type: "button",
          "data-testid": "fail",
          onClick: () => props.onError?.({ type: "error", error: new Error("style 404") }),
        }),
        props.children
      );
    },
  };
});

let root: Root;
let container: HTMLDivElement;
let consoleError: MockInstance<Console["error"]>;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
});

beforeEach(() => {
  map.throws = false;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  consoleError.mockRestore();
});

async function render(props: Partial<React.ComponentProps<typeof ThemedMap>> = {}) {
  await act(async () => {
    root.render(
      <MantineProvider>
        <ThemedMap h={200} mapStyle="https://example.invalid/style.json" {...props}>
          <span data-testid="layer" />
        </ThemedMap>
      </MantineProvider>
    );
  });
}

const busy = () => container.querySelector('[aria-busy="true"]');

async function click(testId: string) {
  await act(async () => {
    container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
  });
}

describe("ThemedMap", () => {
  it("covers the map until it has loaded, and hands the event on", async () => {
    const onLoad = vi.fn<(event: unknown) => void>();
    await render({ onLoad });
    // The map and its layers mount underneath, or it would never load
    expect(busy()).not.toBeNull();
    expect(container.querySelector('[data-testid="layer"]')).not.toBeNull();

    await click("load");

    expect(busy()).toBeNull();
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it("takes the skeleton away when the style fails, and logs the error nobody else handles", async () => {
    await render();

    await click("fail");

    expect(busy()).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(new Error("style 404"));
  });

  it("leaves a failed style to the caller's own handler", async () => {
    const onError = vi.fn<(event: unknown) => void>();
    await render({ onError });

    await click("fail");

    expect(onError).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("keeps a render failure inside the frame", async () => {
    map.throws = true;
    await render();

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
