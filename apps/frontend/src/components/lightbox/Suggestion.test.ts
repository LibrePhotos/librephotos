/**
 * The hashtag popup, placed with Floating UI against the caret. The suggestion
 * plugin answers null for the caret's rect while its decoration is not in the
 * DOM; the popup once handed that straight to its positioner, which threw on
 * it. It now stays where it last was.
 */
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import suggestion from "./Suggestion";

const rendered = vi.hoisted(() => ({ elements: [] as HTMLElement[], onKeyDown: { calls: 0 } }));

// The list itself is not under test; a renderer that renders an empty element.
vi.mock("@tiptap/react", () => ({
  ReactRenderer: class {
    element = document.createElement("div");
    ref = {
      onKeyDown: () => {
        rendered.onKeyDown.calls += 1;
        return true;
      },
    };
    constructor() {
      rendered.elements.push(this.element);
    }
    updateProps() {}
    destroy() {}
  },
}));

const VIEWPORT = { width: 1000, height: 800 };
const POPUP = { width: 200, height: 100 };

let editor: Editor | undefined;

beforeEach(() => {
  // jsdom lays nothing out: give the viewport and the popup a size.
  Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: VIEWPORT.width });
  Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: VIEWPORT.height });
  const holdsList = (element: HTMLElement) => rendered.elements.some(list => list.parentElement === element);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return holdsList(this) ? POPUP.width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return holdsList(this) ? POPUP.height : 0;
  });
});

afterEach(() => {
  Reflect.deleteProperty(document.documentElement, "clientWidth");
  Reflect.deleteProperty(document.documentElement, "clientHeight");
  editor?.destroy();
  editor = undefined;
  rendered.elements.length = 0;
  rendered.onKeyDown.calls = 0;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function props(clientRect: () => DOMRect | null): SuggestionProps<string, MentionNodeAttrs> {
  editor = editor ?? new Editor({ extensions: [Document, Paragraph, Text] });
  return {
    editor,
    range: { from: 1, to: 2 },
    query: "",
    text: "#",
    items: [],
    command: () => {},
    decorationNode: null,
    clientRect,
    placement: "bottom-start",
    offset: { mainAxis: 4, crossAxis: 0 },
    flip: true,
    floatingUi: { placement: "bottom-start", strategy: "absolute", middleware: [] },
    mount: () => () => {},
    loading: false,
  };
}

function keyDown(key: string): SuggestionKeyDownProps {
  return { view: defined(editor).view, event: new KeyboardEvent("keydown", { key }), range: { from: 1, to: 2 } };
}

/** The element on document.body that holds the list. */
function popup(): HTMLElement {
  return defined(defined(rendered.elements[0]).parentElement);
}

/** Waits for the popup to be placed at (left, top). */
async function expectPlacedAt(left: number, top: number) {
  await vi.waitFor(() => {
    expect(popup().style.left).toBe(`${left}px`);
    expect(popup().style.top).toBe(`${top}px`);
  });
}

/** Lets a pending placement land. */
async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe("hashtag suggestion popup", () => {
  it("opens on document.body below the caret, 10px under it and aligned with its left edge", async () => {
    const renderer = suggestion.render?.();
    renderer?.onStart?.(props(() => new DOMRect(100, 200, 2, 20)));

    expect(popup().parentElement).toBe(document.body);
    expect(popup().hidden).toBe(false);
    await expectPlacedAt(100, 230);
  });

  it("follows the caret's rect", async () => {
    const renderer = suggestion.render?.();
    renderer?.onStart?.(props(() => new DOMRect(10, 20, 30, 40)));
    await expectPlacedAt(10, 70);

    renderer?.onUpdate?.(props(() => new DOMRect(50, 60, 30, 40)));
    await expectPlacedAt(50, 110);
  });

  it("stays where it last was when an update reads no rect", async () => {
    const renderer = suggestion.render?.();
    renderer?.onStart?.(props(() => new DOMRect(10, 20, 30, 40)));
    await expectPlacedAt(10, 70);

    renderer?.onUpdate?.(props(() => null));
    await settle();

    await expectPlacedAt(10, 70);
  });

  it("falls back to the viewport origin when it was never placed", async () => {
    const renderer = suggestion.render?.();
    renderer?.onStart?.(props(() => null));

    // The origin, kept 5px off the left edge.
    await expectPlacedAt(5, 10);
  });

  it("flips above the caret when there is no room below it", async () => {
    const renderer = suggestion.render?.();
    renderer?.onStart?.(props(() => new DOMRect(100, 760, 2, 20)));

    await expectPlacedAt(100, 760 - 10 - POPUP.height);
  });

  it("ends at the caret's right edge when there is no room to its right", async () => {
    const renderer = suggestion.render?.();
    renderer?.onStart?.(props(() => new DOMRect(950, 200, 2, 20)));

    await expectPlacedAt(950 + 2 - POPUP.width, 230);
  });

  it("shifts to stay 5px inside the viewport when neither alignment fits", async () => {
    const renderer = suggestion.render?.();
    renderer?.onStart?.(props(() => new DOMRect(1, 200, 2, 20)));

    await expectPlacedAt(5, 230);
  });

  it("moves with the caret when the page scrolls or resizes", async () => {
    let caret = new DOMRect(100, 200, 2, 20);
    const renderer = suggestion.render?.();
    renderer?.onStart?.(props(() => caret));
    await expectPlacedAt(100, 230);

    caret = new DOMRect(100, 150, 2, 20);
    window.dispatchEvent(new Event("scroll"));
    await expectPlacedAt(100, 180);

    caret = new DOMRect(300, 150, 2, 20);
    window.dispatchEvent(new Event("resize"));
    await expectPlacedAt(300, 180);
  });

  it("hands every key but Escape to the list", () => {
    const renderer = suggestion.render?.();
    renderer?.onStart?.(props(() => new DOMRect(100, 200, 2, 20)));

    expect(renderer?.onKeyDown?.(keyDown("ArrowDown"))).toBe(true);
    expect(renderer?.onKeyDown?.(keyDown("Enter"))).toBe(true);
    expect(rendered.onKeyDown.calls).toBe(2);
  });

  it("hides on Escape and no longer follows the page", async () => {
    let caret = new DOMRect(100, 200, 2, 20);
    const renderer = suggestion.render?.();
    renderer?.onStart?.(props(() => caret));
    await expectPlacedAt(100, 230);

    expect(renderer?.onKeyDown?.(keyDown("Escape"))).toBe(true);
    expect(popup().hidden).toBe(true);
    expect(rendered.onKeyDown.calls).toBe(0);

    caret = new DOMRect(400, 400, 2, 20);
    window.dispatchEvent(new Event("scroll"));
    renderer?.onUpdate?.(props(() => caret));
    await settle();
    await expectPlacedAt(100, 230);
  });

  it("hides on a press outside it, not on one inside it", () => {
    const renderer = suggestion.render?.();
    renderer?.onStart?.(props(() => new DOMRect(100, 200, 2, 20)));
    const item = document.createElement("button");
    defined(rendered.elements[0]).appendChild(item);

    item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(popup().hidden).toBe(false);

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(popup().hidden).toBe(true);
  });

  it("leaves the page on exit", () => {
    const renderer = suggestion.render?.();
    const start = props(() => new DOMRect(100, 200, 2, 20));
    renderer?.onStart?.(start);
    const shown = popup();

    renderer?.onExit?.(start);

    expect(shown.isConnected).toBe(false);
    expect(document.body.children).toHaveLength(0);
  });
});
