import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { readNewBuildReloadTime, writeNewBuildReloadTime } from "../util/storage";

const reload = vi.fn<() => void>();

async function freshModule() {
  vi.resetModules();
  return import("./newBuildReload");
}

function preloadError(payload: Error): Event {
  const event = new Event("vite:preloadError", { cancelable: true });
  Object.assign(event, { payload });
  window.dispatchEvent(event);
  return event;
}

const cssGone = () => new Error("Unable to preload CSS for http://localhost/assets/page-old.css");

beforeEach(() => {
  sessionStorage.clear();
  reload.mockClear();
  vi.stubGlobal("location", { ...window.location, reload });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("installNewBuildReload", () => {
  it("reloads the page once when a code file of its build is gone", async () => {
    const { installNewBuildReload } = await freshModule();
    onTestFinished(installNewBuildReload());

    const event = preloadError(cssGone());
    preloadError(new TypeError("Failed to fetch dynamically imported module: http://localhost/assets/a-old.js"));

    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    expect(readNewBuildReloadTime()).toBeDefined();
  });

  it("leaves an error the module itself threw alone", async () => {
    const { installNewBuildReload } = await freshModule();
    onTestFinished(installNewBuildReload());

    preloadError(new TypeError("Cannot read properties of undefined (reading 'x')"));

    expect(reload).not.toHaveBeenCalled();
  });

  it("stops listening when undone", async () => {
    const { installNewBuildReload } = await freshModule();
    installNewBuildReload()();

    preloadError(cssGone());

    expect(reload).not.toHaveBeenCalled();
  });
});

describe("reloadsForNewBuild", () => {
  it.each([
    "Failed to fetch dynamically imported module: http://localhost/assets/a-old.js",
    "error loading dynamically imported module: http://localhost/assets/a-old.js",
    "Importing a module script failed.",
    "Unable to preload CSS for http://localhost/assets/a-old.css",
  ])("knows the message %s", async message => {
    const { reloadsForNewBuild } = await freshModule();

    expect(reloadsForNewBuild(new TypeError(message))).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload again within a minute of the last reload", async () => {
    writeNewBuildReloadTime(Date.now() - 5_000);
    const { reloadsForNewBuild } = await freshModule();

    expect(reloadsForNewBuild(cssGone())).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads again once that minute is over", async () => {
    const { NEW_BUILD_RELOAD_GUARD_MS, reloadsForNewBuild } = await freshModule();
    writeNewBuildReloadTime(Date.now() - NEW_BUILD_RELOAD_GUARD_MS - 1_000);

    expect(reloadsForNewBuild(cssGone())).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload when the tab cannot remember that it did", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const { reloadsForNewBuild } = await freshModule();

    expect(reloadsForNewBuild(cssGone())).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("takes every error once the reload has started", async () => {
    const { reloadsForNewBuild } = await freshModule();

    expect(reloadsForNewBuild(new Error("boom"))).toBe(false);
    reloadsForNewBuild(cssGone());

    expect(reloadsForNewBuild(new Error("boom"))).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
