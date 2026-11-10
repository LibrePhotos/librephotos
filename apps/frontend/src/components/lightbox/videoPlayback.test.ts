import { describe, expect, it } from "vitest";
import { initialPlayback, nextPlayback, shownError, type VideoPlaybackEvent } from "./videoPlayback";

const run = (...events: VideoPlaybackEvent[]) => events.reduce(nextPlayback, initialPlayback());

describe("nextPlayback", () => {
  it("keeps the spinner while a conversion is in reserve, and names no cause yet", () => {
    const state = run({ type: "error", hasConversion: true });

    expect(state).toMatchObject({ phase: "probing", quiet: true });
    expect(shownError(state)).toBeNull();
  });

  it("drops a probe answer that arrives after Retry", () => {
    const state = run(
      { type: "error", hasConversion: false },
      { type: "retry" },
      { type: "probed", kind: "missing", status: 404, hasConversion: false }
    );

    expect(state).toEqual({ phase: "loading", source: "original", attempt: 1 });
  });

  it("converts once, then reports the conversion's own failure", () => {
    const state = run(
      { type: "error", hasConversion: true },
      { type: "probed", kind: "format", status: 200, hasConversion: true },
      { type: "error", hasConversion: true },
      { type: "probed", kind: "format", status: 200, hasConversion: true }
    );

    expect(state).toEqual({ phase: "failed", source: "conversion", attempt: 0, kind: "format", status: 200 });
  });

  it("stays on the conversion when Retry is pressed", () => {
    const state = run(
      { type: "error", hasConversion: true },
      { type: "probed", kind: "format", status: 200, hasConversion: true },
      { type: "error", hasConversion: true },
      { type: "probed", kind: "server", status: 500, hasConversion: true },
      { type: "retry" }
    );

    expect(state).toEqual({ phase: "loading", source: "conversion", attempt: 1 });
  });
});
