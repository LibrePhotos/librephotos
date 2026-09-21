/**
 * `Lightbox` is controlled: it pushes the photo it moved to through
 * `onImageChange` and snaps back whenever `selectedImage` disagrees with what
 * it is showing. This hook is what keeps the two in step -- before it existed,
 * "play all" opened and then replayed its first photo for ever.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it } from "vitest";
import { useSlideshowSelection } from "./useSlideshowSelection";

function photo(id: string) {
  return { id, image_hash: `hash-${id}`, aspectRatio: 1 } as any;
}

/** Drives the hook the way MemorySlideshow does. */
function mount(items: any[]) {
  const seen: Array<string | null> = [];
  let onImageChange: (id: string) => void;

  function Probe({ items: probeItems }: { items: any[] }) {
    const selection = useSlideshowSelection(probeItems);
    onImageChange = selection.onImageChange;
    seen.push(selection.selectedImage);
    return null;
  }

  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe items={items} />));

  return {
    get selected() {
      return seen[seen.length - 1];
    },
    advanceTo(id: string) {
      act(() => onImageChange(id));
    },
    setItems(next: any[]) {
      act(() => root.render(<Probe items={next} />));
    },
  };
}

describe("useSlideshowSelection", () => {
  it("starts on the first photo", () => {
    expect(mount([photo("a"), photo("b")]).selected).toBe("a");
  });

  it("has nothing to show for an empty slideshow", () => {
    expect(mount([]).selected).toBeNull();
  });

  it("follows the lightbox instead of snapping back", () => {
    const slideshow = mount([photo("a"), photo("b"), photo("c")]);
    slideshow.advanceTo("b");
    expect(slideshow.selected).toBe("b");
    slideshow.advanceTo("c");
    expect(slideshow.selected).toBe("c");
  });

  it("keeps its place when more photos arrive mid-slideshow", () => {
    // "Play all" starts with the photos already in hand and grows into the full
    // set as the larger request lands.
    const slideshow = mount([photo("a"), photo("b")]);
    slideshow.advanceTo("b");
    slideshow.setItems([photo("a"), photo("b"), photo("c"), photo("d")]);
    expect(slideshow.selected).toBe("b");
  });

  it("gives way to the first photo when the one it showed is gone", () => {
    const slideshow = mount([photo("a"), photo("b")]);
    slideshow.advanceTo("b");
    slideshow.setItems([photo("c"), photo("d")]);
    expect(slideshow.selected).toBe("c");
  });
});
