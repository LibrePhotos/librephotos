/**
 * #2938: the web app's error listeners. The Sentry client is loaded with the first error, not
 * before; browser noise and errors of extensions are left out; a page stuck in a loop stops.
 */
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  loaded: 0,
  capture: vi.fn<(error: unknown) => void>(),
}));

vi.mock("./sentryClient", () => {
  stubs.loaded += 1;
  return { capture: stubs.capture };
});

async function freshModule() {
  vi.resetModules();
  return import("./reportBrowserError");
}

async function settle() {
  await vi.waitFor(() => Promise.resolve());
  await new Promise(resolve => queueMicrotask(() => resolve(undefined)));
}

beforeEach(() => {
  stubs.loaded = 0;
  stubs.capture.mockClear();
});

describe("installErrorReporting", () => {
  it("loads nothing until an error comes, then captures it", async () => {
    const { installErrorReporting } = await freshModule();
    onTestFinished(installErrorReporting());
    await settle();
    expect(stubs.loaded).toBe(0);

    const error = new TypeError("boom");
    window.dispatchEvent(new ErrorEvent("error", { error, message: "boom", filename: "/assets/index.js" }));
    await vi.waitFor(() => expect(stubs.capture).toHaveBeenCalledWith(error));
    expect(stubs.loaded).toBe(1);
  });

  it("captures a rejected promise's reason", async () => {
    const { installErrorReporting } = await freshModule();
    onTestFinished(installErrorReporting());
    const reason = new Error("rejected");
    const event = new Event("unhandledrejection");
    Object.assign(event, { reason });
    window.dispatchEvent(event);
    await vi.waitFor(() => expect(stubs.capture).toHaveBeenCalledWith(reason));
  });

  it("leaves out browser noise and extensions", async () => {
    const { installErrorReporting } = await freshModule();
    onTestFinished(installErrorReporting());
    window.dispatchEvent(
      new ErrorEvent("error", { message: "ResizeObserver loop completed with undelivered notifications." })
    );
    window.dispatchEvent(new ErrorEvent("error", { message: "Script error." }));
    window.dispatchEvent(new ErrorEvent("error", { message: "x", filename: "chrome-extension://abc/content.js" }));
    await settle();
    expect(stubs.capture).not.toHaveBeenCalled();
    expect(stubs.loaded).toBe(0);
  });

  it("stops after ten reports on one page", async () => {
    const { reportBrowserError } = await freshModule();
    for (let i = 0; i < 15; i += 1) {
      reportBrowserError(new Error(`loop ${i}`));
    }
    await vi.waitFor(() => expect(stubs.capture).toHaveBeenCalledTimes(10));
    await settle();
    expect(stubs.capture).toHaveBeenCalledTimes(10);
  });
});
