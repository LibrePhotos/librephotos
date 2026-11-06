/** A touch long-press on a collection card opens its menu (review r6 #16); a tap and a mouse do not. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useLongPress } from "./useLongPress";

const onLongPress = vi.fn<() => void>();
const onClick = vi.fn<() => void>();

function Card() {
  const handlers = useLongPress(onLongPress);
  return (
    <div {...handlers}>
      <button type="button" onClick={onClick}>
        card
      </button>
    </div>
  );
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  onLongPress.mockReset();
  onClick.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/** A pointer event of `type`; jsdom has no PointerEvent, so a MouseEvent with its fields. */
function pointer(type: string, pointerType: string, x = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
}

async function renderCard() {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => root.render(<Card />));
  const button = container.querySelector("button");
  if (!button) throw new Error("no button");
  return button;
}

describe("useLongPress", () => {
  it("opens after 500ms held still, and swallows the click of the release", async () => {
    const button = await renderCard();
    await act(async () => {
      button.dispatchEvent(pointer("pointerdown", "touch"));
      vi.advanceTimersByTime(500);
    });
    expect(onLongPress).toHaveBeenCalledTimes(1);
    await act(async () => {
      button.dispatchEvent(pointer("pointerup", "touch"));
      button.click();
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("leaves a tap a click", async () => {
    const button = await renderCard();
    await act(async () => {
      button.dispatchEvent(pointer("pointerdown", "touch"));
      vi.advanceTimersByTime(200);
      button.dispatchEvent(pointer("pointerup", "touch"));
      button.click();
    });
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("gives up when the finger moves: that is a scroll", async () => {
    const button = await renderCard();
    await act(async () => {
      button.dispatchEvent(pointer("pointerdown", "touch"));
      button.dispatchEvent(pointer("pointermove", "touch", 30));
      vi.advanceTimersByTime(600);
    });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("ignores a mouse held down", async () => {
    const button = await renderCard();
    await act(async () => {
      button.dispatchEvent(pointer("pointerdown", "mouse"));
      vi.advanceTimersByTime(600);
    });
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
