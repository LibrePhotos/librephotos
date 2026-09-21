/**
 * Repro for "Play All opens the slideshow and just loops on the first photo".
 *
 * The advance itself happens inside `ContentViewer` (its slideshow timer calls
 * `onMoveNextRequest`), so that is the one piece stubbed out here: the real
 * `Lightbox` and the real `MemorySlideshow` wiring are what is under test,
 * because the bug lived in how the two talk to each other. Passing a fixed
 * `selectedImage`, as the page first did, makes the second assertion fail.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it, vi } from "vitest";
import { MemorySlideshow } from "./MemorySlideshow";

// vitest hoists these above the imports, so the stubs are in place either way.
vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoDetailsQuery: () => ({ data: undefined }),
}));

// Stands in for the viewer, exposing what it would otherwise do on a timer.
vi.mock("../lightbox/ContentViewer", () => ({
  ContentViewer: ({ mainSrc, nextSrc, onMoveNextRequest, onMovePrevRequest, startSlideshow }: any) => (
    <div>
      <span data-testid="shown">{mainSrc}</span>
      <span data-testid="next">{nextSrc ?? "end"}</span>
      <span data-testid="slideshow">{String(startSlideshow)}</span>
      <button type="button" data-testid="advance" onClick={onMoveNextRequest} />
      <button type="button" data-testid="back" onClick={onMovePrevRequest} />
    </div>
  ),
}));

function photo(id: string) {
  return { id, image_hash: `hash-${id}`, aspectRatio: 1 } as any;
}

function play(items: any[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<MemorySlideshow items={items} onClose={() => {}} />));

  const text = (testid: string) => container.querySelector(`[data-testid="${testid}"]`)?.textContent;
  const click = (testid: string) =>
    act(() => {
      container.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)?.click();
    });

  return {
    get shown() {
      return text("shown");
    },
    get next() {
      return text("next");
    },
    get slideshowStarted() {
      return text("slideshow");
    },
    advance: () => click("advance"),
    back: () => click("back"),
    container,
  };
}

describe("MemorySlideshow", () => {
  it("opens on the first photo, already playing", () => {
    const slideshow = play([photo("a"), photo("b")]);
    expect(slideshow.shown).toBe("a");
    expect(slideshow.slideshowStarted).toBe("true");
  });

  it("advances, and stays advanced", () => {
    const slideshow = play([photo("a"), photo("b"), photo("c")]);
    slideshow.advance();
    expect(slideshow.shown).toBe("b");
    slideshow.advance();
    expect(slideshow.shown).toBe("c");
  });

  it("goes back as well", () => {
    const slideshow = play([photo("a"), photo("b"), photo("c")]);
    slideshow.advance();
    slideshow.back();
    expect(slideshow.shown).toBe("a");
  });

  it("runs out at the last photo, so the slideshow can stop", () => {
    const slideshow = play([photo("a"), photo("b")]);
    expect(slideshow.next).toBe("b");
    slideshow.advance();
    expect(slideshow.next).toBe("end");
  });

  it("renders nothing when there is no photo to play", () => {
    expect(play([]).container.textContent).toBe("");
  });
});
