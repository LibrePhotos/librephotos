import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ContentCard } from "./ContentCard";
import { FloatingCard } from "./FloatingCard";
import { MediaCard } from "./MediaCard";
import { Panel } from "./Panel";

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
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
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function surfaceOf(element: React.ReactNode): HTMLElement {
  act(() => root.render(<MantineProvider>{element}</MantineProvider>));
  const surface = container.querySelector<HTMLElement>("[data-testid='surface']");
  if (!surface) throw new Error("surface not rendered");
  return surface;
}

describe("surfaces", () => {
  it.each([
    ["ContentCard", <ContentCard key="c" data-testid="surface" />, "lg", null],
    ["Panel", <Panel key="p" data-testid="surface" />, "md", null],
    ["FloatingCard", <FloatingCard key="f" data-testid="surface" />, "lg", "xl"],
    ["MediaCard", <MediaCard key="m" data-testid="surface" />, "md", null],
  ])("%s draws its own border, radius and shadow", (_name, element, radius, shadow) => {
    const surface = surfaceOf(element);
    expect(surface.hasAttribute("data-with-border")).toBe(true);
    expect(surface.style.getPropertyValue("--paper-radius")).toBe(`var(--mantine-radius-${radius})`);
    expect(surface.style.getPropertyValue("--paper-shadow")).toBe(shadow ? `var(--mantine-shadow-${shadow})` : "");
  });

  it("renders as another element", () => {
    const surface = surfaceOf(<Panel component="section" data-testid="surface" />);
    expect(surface.tagName).toBe("SECTION");
  });

  it("lays a media section edge to edge", () => {
    surfaceOf(
      <MediaCard data-testid="surface">
        <MediaCard.Section data-testid="section" />
      </MediaCard>
    );
    expect(container.querySelector("[data-testid='section']")).not.toBeNull();
  });
});
