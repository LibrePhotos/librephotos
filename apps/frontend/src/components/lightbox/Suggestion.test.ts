/**
 * The hashtag popup's anchor. The suggestion plugin answers null for the
 * caret's rect while its decoration is not in the DOM; the popup used to hand
 * that straight to tippy, which threw on it. It now stays where it last was.
 */
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import type { SuggestionProps } from "@tiptap/suggestion";
import tippy, { type Props } from "tippy.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import suggestion from "./Suggestion";

const instance = vi.hoisted(() => ({
  setProps: vi.fn<(partial: Partial<Props>) => void>(),
  hide: vi.fn<() => void>(),
  destroy: vi.fn<() => void>(),
}));

vi.mock("tippy.js", () => ({ default: vi.fn(() => [instance]) }));
// The list itself is not under test; a renderer that renders nothing.
vi.mock("@tiptap/react", () => ({
  ReactRenderer: class {
    element = document.createElement("div");
    ref = null;
    updateProps() {}
    destroy() {}
  },
}));

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  vi.clearAllMocks();
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

/** The anchor getter tippy was created with. */
function startAnchor() {
  return vi.mocked(tippy).mock.calls[0]?.[1]?.getReferenceClientRect;
}

/** The anchor getter the latest onUpdate handed to tippy. */
function updatedAnchor() {
  return instance.setProps.mock.lastCall?.[0].getReferenceClientRect;
}

describe("hashtag suggestion popup anchor", () => {
  it("follows the caret's rect", () => {
    const renderer = suggestion.render?.();
    renderer?.onStart?.(props(() => new DOMRect(10, 20, 30, 40)));
    renderer?.onUpdate?.(props(() => new DOMRect(50, 60, 30, 40)));

    expect(startAnchor()?.()).toMatchObject({ x: 10, y: 20 });
    expect(updatedAnchor()?.()).toMatchObject({ x: 50, y: 60 });
  });

  it("stays where it last was when an update reads no rect", () => {
    const renderer = suggestion.render?.();
    renderer?.onStart?.(props(() => new DOMRect(10, 20, 30, 40)));
    expect(startAnchor()?.()).toMatchObject({ x: 10, y: 20 });

    renderer?.onUpdate?.(props(() => null));

    expect(updatedAnchor()?.()).toMatchObject({ x: 10, y: 20, width: 30, height: 40 });
  });

  it("falls back to the viewport origin when it was never placed", () => {
    const renderer = suggestion.render?.();
    renderer?.onStart?.(props(() => null));

    expect(startAnchor()?.()).toMatchObject({ x: 0, y: 0 });
  });
});
