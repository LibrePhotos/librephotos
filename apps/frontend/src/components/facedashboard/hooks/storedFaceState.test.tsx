/**
 * The faces dashboard keeps each tab's scroll position and folded person groups in
 * localStorage. What comes back from there is not trusted: a value of the wrong shape is
 * dropped, field by field, instead of reaching the grid.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../../util/storage";
import { FacesTab } from "../facesTab";
import { useCollapsedPersons } from "./useCollapsedPersons";
import { useTabScrollPositions } from "./useTabScrollPositions";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderHook<T>(useHook: () => T) {
  const container = document.createElement("div");
  const root = createRoot(container);
  let rendered: { value: T } | undefined;
  function Host() {
    rendered = { value: useHook() };
    return null;
  }
  await act(async () => {
    root.render(<Host />);
  });
  return {
    get current(): T {
      if (!rendered) throw new Error("the hook has not rendered");
      return rendered.value;
    },
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

describe("useTabScrollPositions", () => {
  it("starts every tab at the top when nothing is stored", async () => {
    const view = await renderHook(useTabScrollPositions);

    expect(view.current.tabPositions).toEqual({ labeled: 0, inferred: 0, unknown: 0, deleted: 0 });

    await view.cleanup();
  });

  it("keeps the stored numeric positions and drops the rest", async () => {
    localStorage.setItem(
      STORAGE_KEYS.facesTabScrollPositions,
      JSON.stringify({ labeled: 120, inferred: "far", other: 5 })
    );
    const view = await renderHook(useTabScrollPositions);

    expect(view.current.tabPositions.labeled).toBe(120);
    expect(view.current.tabPositions.inferred).toBeUndefined();
    expect(view.current.tabPositions.unknown).toBeUndefined();
    expect(view.current.tabPositions).not.toHaveProperty("other");

    await view.cleanup();
  });

  it.each(["null", "5", "[1, 2]", '"labeled"'])("reads %s as no stored positions", async stored => {
    localStorage.setItem(STORAGE_KEYS.facesTabScrollPositions, stored);
    const view = await renderHook(useTabScrollPositions);

    expect(view.current.tabPositions).toEqual({});

    await view.cleanup();
  });

  it("falls back to the top of every tab when the stored value is not JSON", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEYS.facesTabScrollPositions, "{not json");
    const view = await renderHook(useTabScrollPositions);

    expect(view.current.tabPositions).toEqual({ labeled: 0, inferred: 0, unknown: 0, deleted: 0 });
    expect(consoleError).toHaveBeenCalled();

    await view.cleanup();
  });

  it("writes a new position back", async () => {
    localStorage.setItem(STORAGE_KEYS.facesTabScrollPositions, JSON.stringify({ labeled: 120 }));
    const view = await renderHook(useTabScrollPositions);

    await act(async () => {
      view.current.updatePosition(FacesTab.enum.inferred, 40);
    });

    expect(view.current.tabPositions).toEqual({ labeled: 120, inferred: 40 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.facesTabScrollPositions) ?? "{}")).toEqual({
      labeled: 120,
      inferred: 40,
    });

    await view.cleanup();
  });
});

describe("useCollapsedPersons", () => {
  it("keeps the numeric ids of each tab and drops the rest", async () => {
    localStorage.setItem(
      STORAGE_KEYS.facesCollapsedPersons,
      JSON.stringify({ labeled: [1, "2", 3, null], inferred: "x" })
    );
    const view = await renderHook(useCollapsedPersons);

    expect(view.current.collapsedPersons).toEqual({
      labeled: new Set([1, 3]),
      inferred: new Set(),
      unknown: new Set(),
      deleted: new Set(),
    });

    await view.cleanup();
  });

  it.each(["null", "5", "[7]"])("reads %s as nothing folded", async stored => {
    localStorage.setItem(STORAGE_KEYS.facesCollapsedPersons, stored);
    const view = await renderHook(useCollapsedPersons);

    expect(view.current.collapsedPersons).toEqual({
      labeled: new Set(),
      inferred: new Set(),
      unknown: new Set(),
      deleted: new Set(),
    });

    await view.cleanup();
  });

  it("reads a value that is not JSON as nothing folded", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEYS.facesCollapsedPersons, "{not json");
    const view = await renderHook(useCollapsedPersons);

    expect(view.current.collapsedPersons).toEqual({
      labeled: new Set(),
      inferred: new Set(),
      unknown: new Set(),
      deleted: new Set(),
    });
    expect(consoleError).toHaveBeenCalled();

    await view.cleanup();
  });

  it("keeps the folds stored before the Deleted tab, which starts with nothing folded (#127)", async () => {
    localStorage.setItem(
      STORAGE_KEYS.facesCollapsedPersons,
      JSON.stringify({ labeled: [4], inferred: [], unknown: [] })
    );
    const view = await renderHook(useCollapsedPersons);

    expect(view.current.collapsedPersons.labeled).toEqual(new Set([4]));
    expect(view.current.collapsedPersons.deleted).toEqual(new Set());

    await act(async () => {
      view.current.toggleCollapsed(FacesTab.enum.deleted, 9);
    });

    expect(view.current.collapsedPersons.deleted).toEqual(new Set([9]));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.facesCollapsedPersons) ?? "{}")).toMatchObject({
      labeled: [4],
      deleted: [9],
    });

    await view.cleanup();
  });
});
