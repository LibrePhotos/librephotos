/** Drag-down-to-close on the phone sheets (BottomSheet, the viewer's info sheet). */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { useSheetDrag } from "./useSheetDrag";

const onClose = vi.fn<() => void>();
let root: Root | undefined;
let container: HTMLDivElement;

function Sheet() {
  const { sheet, handlers } = useSheetDrag<HTMLDivElement>(onClose);
  return (
    <div ref={sheet} data-testid="sheet">
      <div data-testid="handle" {...handlers}>
        <button type="button">Close</button>
      </div>
    </div>
  );
}

/** A pointer event at `clientY` and `timeStamp` (jsdom has no PointerEvent; React reads a 0 stamp as none). */
function pointer(type: string, target: Element, clientY: number, timeStamp: number) {
  const event = new MouseEvent(type, { bubbles: true, clientY });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  act(() => {
    target.dispatchEvent(event);
  });
}

function drag(target: Element, distance: number, duration: number) {
  pointer("pointerdown", target, 100, 1);
  pointer("pointermove", target, 100 + distance, duration);
  pointer("pointerup", target, 100 + distance, duration);
}

const handle = () => defined(container.querySelector('[data-testid="handle"]'));
const sheet = () => defined(container.querySelector<HTMLElement>('[data-testid="sheet"]'));

beforeEach(() => {
  onClose.mockReset();
  HTMLElement.prototype.setPointerCapture = vi.fn<HTMLElement["setPointerCapture"]>();
  HTMLElement.prototype.animate = vi.fn<HTMLElement["animate"]>();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Sheet />));
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

describe("useSheetDrag", () => {
  it("closes the sheet on a long drag down", () => {
    drag(handle(), 120, 600);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes it on a short, fast flick", () => {
    drag(handle(), 40, 40);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("springs back after a short, slow drag", () => {
    pointer("pointerdown", handle(), 100, 1);
    pointer("pointermove", handle(), 140, 400);
    expect(sheet().style.getPropertyValue("--sheet-drag")).toBe("40px");
    pointer("pointerup", handle(), 140, 800);
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet().style.getPropertyValue("--sheet-drag")).toBe("0px");
  });

  it("does not follow a drag up", () => {
    pointer("pointerdown", handle(), 100, 1);
    pointer("pointermove", handle(), 20, 100);
    expect(sheet().style.getPropertyValue("--sheet-drag")).toBe("0px");
  });

  it("leaves a press on a button to the button", () => {
    drag(defined(handle().querySelector("button")), 200, 300);
    expect(onClose).not.toHaveBeenCalled();
  });
});
