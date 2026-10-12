/**
 * The one place localStorage is read and written. What comes back is never trusted, a
 * write that the browser refuses does not take the page down, and a value saved under a
 * key from before the rename is moved to the current key the first time it is read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { readStored, STORAGE_KEYS, subscribeStored, writeStored } from "./storage";

const KEY = STORAGE_KEYS.recentlyTaggedPeople;
const LEGACY_KEY = "recentlyTaggedPeople";
const schema = z.array(z.string());

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readStored", () => {
  it("gives the fallback when nothing is stored", () => {
    expect(readStored(KEY, schema, ["fallback"])).toEqual(["fallback"]);
  });

  it("gives the stored value when it matches the schema", () => {
    localStorage.setItem(KEY, JSON.stringify(["a", "b"]));

    expect(readStored(KEY, schema, [])).toEqual(["a", "b"]);
  });

  it("gives the fallback for a value of the wrong shape", () => {
    localStorage.setItem(KEY, JSON.stringify({ not: "a list" }));

    expect(readStored(KEY, schema, ["fallback"])).toEqual(["fallback"]);
  });

  it("logs and gives the fallback for text that is not JSON", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(KEY, "{not json");

    expect(readStored(KEY, schema, ["fallback"])).toEqual(["fallback"]);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("gives the fallback for an empty value without logging", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(KEY, "");

    expect(readStored(KEY, schema, ["fallback"])).toEqual(["fallback"]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("gives the fallback when storage cannot be read at all", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    expect(readStored(KEY, schema, ["fallback"])).toEqual(["fallback"]);
    expect(consoleError).toHaveBeenCalled();
  });

  it("moves a value saved under the old key to the current key, once", () => {
    const saved = JSON.stringify(["old"]);
    localStorage.setItem(LEGACY_KEY, saved);

    expect(readStored(KEY, schema, [])).toEqual(["old"]);

    expect(localStorage.getItem(KEY)).toBe(saved);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("still reads the old value when the browser refuses the move", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(["old"]));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });

    expect(readStored(KEY, schema, [])).toEqual(["old"]);
  });

  it("ignores the old key once the current key holds a value, even a corrupt one", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(KEY, "{not json");
    localStorage.setItem(LEGACY_KEY, JSON.stringify(["old"]));

    expect(readStored(KEY, schema, ["fallback"])).toEqual(["fallback"]);
    expect(localStorage.getItem(LEGACY_KEY)).toBe(JSON.stringify(["old"]));
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});

describe("writeStored", () => {
  it("stores the value as JSON and drops the old key's copy", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(["old"]));

    writeStored(KEY, ["new"]);

    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(["new"]));
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("logs a write the browser refuses, and does not throw", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });

    expect(() => writeStored(KEY, ["new"])).not.toThrow();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("tells the subscribers of its key, and stops once they unsubscribe", () => {
    const listener = vi.fn<() => void>();
    const other = vi.fn<() => void>();
    const unsubscribe = subscribeStored(KEY, listener);
    subscribeStored(STORAGE_KEYS.facesTabScrollPositions, other);

    writeStored(KEY, ["a"]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();

    unsubscribe();
    writeStored(KEY, ["b"]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
