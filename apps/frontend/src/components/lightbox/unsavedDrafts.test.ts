/** The per-view registry of unsaved drafts (#2284) the lightbox and the photo page ask before leaving. */
import { describe, expect, it, vi } from "vitest";
import { createUnsavedDrafts } from "./unsavedDrafts";

describe("createUnsavedDrafts", () => {
  it("lists the dirty fields in a fixed order, the same array until they change", () => {
    const drafts = createUnsavedDrafts();
    drafts.set("tags", true);
    drafts.set("date", true);
    const first = drafts.dirtyFields();

    expect(first).toEqual(["date", "tags"]);
    drafts.set("tags", true);
    expect(drafts.dirtyFields()).toBe(first);

    drafts.set("date", false);
    expect(drafts.dirtyFields()).toEqual(["tags"]);
  });

  it("tells subscribers about a change only, and stops after unsubscribing", () => {
    const drafts = createUnsavedDrafts();
    const listener = vi.fn<() => void>();
    const unsubscribe = drafts.subscribe(listener);

    drafts.set("caption", false);
    expect(listener).not.toHaveBeenCalled();
    drafts.set("caption", true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    drafts.set("caption", false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("forgets every draft on discard", () => {
    const drafts = createUnsavedDrafts();
    const listener = vi.fn<() => void>();
    drafts.subscribe(listener);
    drafts.discardAll();
    expect(listener).not.toHaveBeenCalled();

    drafts.set("caption", true);
    drafts.set("location", true);
    drafts.discardAll();

    expect(drafts.dirtyFields()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
