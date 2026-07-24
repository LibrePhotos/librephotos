/**
 * Tests for the "live text" OCR overlay.
 *
 * The backend serializer (PhotoSerializer.get_ocr) delivers blocks whose `box`
 * is a four-corner quad normalized to [0, 1] of the OCR source image. The
 * overlay maps those quads into a 1000-unit-wide SVG viewBox whose height
 * follows the image aspect ratio, so x and y share one scale and the invisible
 * selectable glyphs line up with the printed text underneath.
 */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PhotoOcrBlock } from "../../api_client/photos/types";
import { OcrTextOverlay, placeBlock } from "./OcrTextOverlay";

const axisAlignedBlock: PhotoOcrBlock = {
  text: "TOTAL 12.34",
  // Top-left quarter strip of the image: x 10%..60%, y 10%..20%
  box: [
    [0.1, 0.1],
    [0.6, 0.1],
    [0.6, 0.2],
    [0.1, 0.2],
  ],
  confidence: 0.95,
};

describe("placeBlock", () => {
  // A 2:1 landscape image -> viewBox is 1000 x 500 units.
  const viewHeight = 500;

  it("maps a normalized axis-aligned quad into viewBox units", () => {
    const placed = placeBlock(axisAlignedBlock, viewHeight);
    expect(placed).not.toBeNull();
    expect(placed!.x).toBeCloseTo(100);
    expect(placed!.y).toBeCloseTo(50);
    expect(placed!.width).toBeCloseTo(500);
    expect(placed!.height).toBeCloseTo(50);
    expect(placed!.angle).toBeCloseTo(0);
  });

  it("derives the rotation angle from the top edge", () => {
    // Top edge rises to the right in a square viewBox: 45 degrees downward
    // slope in SVG coordinates (y grows down).
    const rotated: PhotoOcrBlock = {
      text: "slanted",
      box: [
        [0.1, 0.1],
        [0.2, 0.2],
        [0.15, 0.25],
        [0.05, 0.15],
      ],
      confidence: 0.9,
    };
    const placed = placeBlock(rotated, 1000);
    expect(placed).not.toBeNull();
    expect(placed!.angle).toBeCloseTo(45);
  });

  it("rejects degenerate and malformed blocks", () => {
    expect(
      placeBlock(
        {
          text: "zero area",
          box: [
            [0.5, 0.5],
            [0.5, 0.5],
            [0.5, 0.5],
            [0.5, 0.5],
          ],
        },
        500
      )
    ).toBeNull();
    expect(placeBlock({ text: "", box: axisAlignedBlock.box }, 500)).toBeNull();
  });
});

describe("OcrTextOverlay", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (blocks: PhotoOcrBlock[], aspectRatio = 0.5) => {
    act(() => {
      root.render(<OcrTextOverlay blocks={blocks} aspectRatio={aspectRatio} />);
    });
  };

  it("renders each block's text as selectable transparent glyphs", () => {
    render([axisAlignedBlock]);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // viewBox height follows the aspect ratio so glyphs stay undistorted.
    expect(svg!.getAttribute("viewBox")).toBe("0 0 1000 500");
    const text = container.querySelector("text");
    expect(text).not.toBeNull();
    expect(text!.textContent).toBe("TOTAL 12.34");
    expect(text!.getAttribute("fill")).toBe("transparent");
    expect(text!.getAttribute("textLength")).not.toBeNull();
  });

  it("keeps the svg transparent to pointer events, glyphs interactive", () => {
    render([axisAlignedBlock]);
    const svg = container.querySelector("svg");
    expect(svg!.style.pointerEvents).toBe("none");
    const text = container.querySelector("text") as SVGTextElement;
    expect(text.style.pointerEvents).toBe("auto");
  });

  it("renders nothing when every block is unplaceable", () => {
    render([{ text: "", box: axisAlignedBlock.box }]);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("stops pointerdown on glyphs from bubbling out (would start a swipe)", () => {
    render([axisAlignedBlock]);
    let escaped = false;
    const listener = () => {
      escaped = true;
    };
    container.addEventListener("pointerdown", listener);
    const text = container.querySelector("text") as SVGTextElement;
    // jsdom lacks PointerEvent; a bubbling Event with the right type is enough
    // to exercise the native capture-free stopPropagation listener.
    text.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    container.removeEventListener("pointerdown", listener);
    expect(escaped).toBe(false);
  });
});
