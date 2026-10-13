/**
 * #2245: the place tree's toolbar toggles had their label only in a Tooltip and did not say which one
 * was chosen, and the zoom buttons were named in English whatever the language.
 */
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { PlaceTreeToolbar, PlaceTreeZoomControls } from "./PlaceTreeControls";
import type { TreeLayout, TreeLinkType, TreeOrientation } from "./PlaceTreeControls";

const onLayoutChange = vi.fn<(layout: TreeLayout) => void>();
const onOrientationChange = vi.fn<(orientation: TreeOrientation) => void>();
const onLinkTypeChange = vi.fn<(linkType: TreeLinkType) => void>();

function renderToolbar(layout: TreeLayout) {
  return renderInMantine(
    <PlaceTreeToolbar
      layout={layout}
      orientation="vertical"
      linkType="step"
      onLayoutChange={onLayoutChange}
      onOrientationChange={onOrientationChange}
      onLinkTypeChange={onLinkTypeChange}
    />
  );
}

const button = (container: HTMLElement, name: string) =>
  defined(container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`), name);

/** Each named group with its buttons as `name: pressed`. */
const groups = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[role="group"]'), group => ({
    group: group.getAttribute("aria-label"),
    buttons: Array.from(
      group.querySelectorAll("button"),
      toggle => `${toggle.getAttribute("aria-label")}: ${toggle.getAttribute("aria-pressed")}`
    ),
  }));

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("PlaceTreeToolbar", () => {
  it("names every toggle and marks the chosen one pressed", async () => {
    const { container } = await renderToolbar("cartesian");

    expect(groups(container)).toEqual([
      { group: "Layout", buttons: ["Tree: true", "Radial: false"] },
      { group: "Direction", buttons: ["Horizontal: false", "Vertical: true"] },
      { group: "Connections", buttons: ["Smooth: false", "Step: true", "Line: false"] },
    ]);
  });

  it("drops the direction toggles for the radial layout", async () => {
    const { container } = await renderToolbar("polar");

    expect(groups(container).map(group => group.group)).toEqual(["Layout", "Connections"]);
    expect(button(container, "Radial").getAttribute("aria-pressed")).toBe("true");
  });

  it("reports the toggle pressed", async () => {
    const { container } = await renderToolbar("cartesian");

    button(container, "Radial").click();
    button(container, "Horizontal").click();
    button(container, "Line").click();

    expect(onLayoutChange).toHaveBeenCalledWith("polar");
    expect(onOrientationChange).toHaveBeenCalledWith("horizontal");
    expect(onLinkTypeChange).toHaveBeenCalledWith("line");
  });
});

describe("PlaceTreeZoomControls", () => {
  it("names the zoom buttons from the translation and shows the level", async () => {
    const onZoomIn = vi.fn<() => void>();
    const onZoomOut = vi.fn<() => void>();
    const onReset = vi.fn<() => void>();
    const { container } = await renderInMantine(
      <PlaceTreeZoomControls zoom={1.5} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onReset={onReset} />
    );

    button(container, "Zoom in (+)").click();
    button(container, "Zoom out (-)").click();
    button(container, "Reset view (0)").click();

    expect(container.textContent).toContain("150%");
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledOnce();
  });
});
