import { describe, expect, it } from "vitest";
import { canSeek, startPosition, videoStartFor, videoStartOf } from "./videoStart";

function seekable(ranges: [number, number][]): Pick<HTMLVideoElement, "seekable"> {
  return {
    seekable: {
      length: ranges.length,
      start: (index: number) => ranges[index]?.[0] ?? 0,
      end: (index: number) => ranges[index]?.[1] ?? 0,
    },
  };
}

describe("video start (#2762)", () => {
  it("starts a second early, never before the beginning", () => {
    expect(startPosition(42)).toBe(41);
    expect(startPosition(0.4)).toBe(0);
  });

  it("has a start only for a face from a later frame", () => {
    expect(videoStartOf(null)).toBeUndefined();
    expect(videoStartOf(undefined, "Anna")).toBeUndefined();
    expect(videoStartOf(0, "Anna")).toEqual({ seconds: 0, name: "Anna" });
    expect(videoStartOf(12.5, "")).toEqual({ seconds: 12.5 });
  });

  it("can seek only a stream with a seekable window", () => {
    expect(canSeek(seekable([[0, 151]]))).toBe(true);
    expect(canSeek(seekable([]))).toBe(false);
    expect(canSeek(seekable([[0, 0]]))).toBe(false);
  });

  it("finds the start of the lightbox's current item", () => {
    const items = [
      { id: "a", image_hash: "a" },
      { id: "b", image_hash: "b", videoStart: { seconds: 42 } },
    ];
    expect(videoStartFor(items, "b")).toEqual({ seconds: 42 });
    expect(videoStartFor(items, "a")).toBeUndefined();
    expect(videoStartFor(items, "c")).toBeUndefined();
  });
});
