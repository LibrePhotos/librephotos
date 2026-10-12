import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateAfter, POLL_ACTIVE_MS, POLL_IDLE_MS, PollTimeoutError, pollUntil, pollWhile } from "./polling";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pollWhile", () => {
  const busy = pollWhile<{ busy: boolean }>(state => state.busy);

  it("polls at the active interval while the data says so, and at the idle interval otherwise", () => {
    expect(busy({ state: { data: { busy: true } } })).toBe(POLL_ACTIVE_MS);
    expect(busy({ state: { data: { busy: false } } })).toBe(POLL_IDLE_MS);
  });

  it("does not poll at the active interval before the first answer", () => {
    expect(busy({ state: { data: undefined } })).toBe(POLL_IDLE_MS);
  });

  it("stops polling when the idle interval is false", () => {
    const untilDone = pollWhile<{ done: boolean }>(state => !state.done, false);
    expect(untilDone({ state: { data: { done: false } } })).toBe(POLL_ACTIVE_MS);
    expect(untilDone({ state: { data: { done: true } } })).toBe(false);
    expect(untilDone({ state: { data: undefined } })).toBe(false);
  });
});

describe("pollUntil", () => {
  it("checks after each interval and resolves with the first result that is done", async () => {
    const check = vi
      .fn<() => Promise<{ status: string }>>()
      .mockResolvedValueOnce({ status: "PENDING" })
      .mockResolvedValueOnce({ status: "PENDING" })
      .mockResolvedValueOnce({ status: "SUCCESS" });

    const result = pollUntil(check, { isDone: r => r.status === "SUCCESS", intervalMs: 3000 });

    await vi.advanceTimersByTimeAsync(2999);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(check).toHaveBeenCalledTimes(3);
    await expect(result).resolves.toEqual({ status: "SUCCESS" });
  });

  it("rejects at once when a check throws, without another check", async () => {
    const check = vi.fn<() => Promise<never>>().mockRejectedValue(new Error("network"));
    const result = pollUntil(check, { isDone: () => true, intervalMs: 1000 });
    const settled = expect(result).rejects.toThrow("network");

    await vi.advanceTimersByTimeAsync(1000);
    await settled;
    await vi.advanceTimersByTimeAsync(10000);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("rejects with the abort reason and stops checking when aborted while waiting", async () => {
    const check = vi.fn<() => Promise<{ done: boolean }>>().mockResolvedValue({ done: false });
    const controller = new AbortController();
    const result = pollUntil(check, { isDone: r => r.done, intervalMs: 1000, signal: controller.signal });
    const settled = expect(result).rejects.toThrow("cancelled");

    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(1);
    controller.abort(new Error("cancelled"));
    await settled;
    await vi.advanceTimersByTimeAsync(10000);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("does not resolve with a done result that arrived after the abort", async () => {
    const controller = new AbortController();
    const check = vi.fn<() => Promise<{ done: boolean }>>().mockImplementation(async () => {
      controller.abort(new Error("cancelled"));
      return { done: true };
    });
    const result = pollUntil(check, { isDone: r => r.done, intervalMs: 1000, signal: controller.signal });
    const settled = expect(result).rejects.toThrow("cancelled");

    await vi.advanceTimersByTimeAsync(1000);
    await settled;
  });

  it("rejects with PollTimeoutError when the timeout passes without a done result", async () => {
    const check = vi.fn<() => Promise<{ done: boolean }>>().mockResolvedValue({ done: false });
    const result = pollUntil(check, { isDone: r => r.done, intervalMs: 1000, timeoutMs: 2500 });
    const settled = expect(result).rejects.toBeInstanceOf(PollTimeoutError);

    await vi.advanceTimersByTimeAsync(3000);
    await settled;
    expect(check).toHaveBeenCalledTimes(3);
  });
});

describe("invalidateAfter", () => {
  it("invalidates each key once the delay has passed", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    invalidateAfter(client, [["faces"], ["people"]], 100);
    expect(invalidate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["faces"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["people"] });
  });
});
