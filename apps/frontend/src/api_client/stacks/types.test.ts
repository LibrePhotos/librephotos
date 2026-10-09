/**
 * The stack stats still count legacy RAW + JPEG and Live Photo stacks, which the
 * list never returns. The Organizing tab badge must only count what the list can show.
 *
 * Migration 0112 left the legacy stacks it could not convert, and photo lists,
 * photo details and the stack detail still return them: one such photo must not
 * fail the parse of a whole timeline page or of the lightbox.
 */
import { PigPhoto } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { Photo } from "../photos/types";
import { countListedStacks, PhotoStack } from "./types";

describe("countListedStacks", () => {
  it("leaves out legacy stack types", () => {
    const stats = {
      total_stacks: 10,
      by_type: { burst: 3, bracket: 2, manual: 1, raw_jpeg: 3, live_photo: 1 },
      photos_in_stacks: 30,
      total_photos: 100,
    };
    expect(countListedStacks(stats)).toBe(6);
  });

  it("treats a missing type as none", () => {
    expect(countListedStacks({ total_stacks: 0, by_type: {}, photos_in_stacks: 0, total_photos: 0 })).toBe(0);
  });
});

describe("legacy RAW + JPEG and Live Photo stacks", () => {
  const stackId = "6f1c1d4e-2b1a-4c3d-9e8f-0a1b2c3d4e5f";

  it.each(["raw_jpeg", "live_photo"])("parse in a photo list item (%s)", type => {
    const item = PigPhoto.parse({
      id: "0d8e8f1a-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
      image_hash: "abc",
      aspectRatio: 1.5,
      stacks: [{ id: stackId, type, photo_count: 2, is_primary: true }],
    });
    expect(item.stacks?.[0].type).toBe(type);
  });

  it("parse in a photo's stack details", () => {
    const stacks = Photo.shape.stacks.parse([
      { id: stackId, type: "live_photo", type_display: "Live Photo", photo_count: 2, is_primary: true, photos: [] },
    ]);
    expect(stacks?.[0].type).toBe("live_photo");
  });

  it("parse as a stack detail, and have a label", () => {
    const stack = PhotoStack.parse({
      id: stackId,
      stack_type: "raw_jpeg",
      stack_type_display: "RAW + JPEG Pair (Deprecated)",
      photo_count: 2,
      sequence_start: null,
      sequence_end: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      primary_photo_hash: null,
      photos: [],
    });
    const key = `stacks.typelabel.${stack.stack_type}`;
    expect(i18n.exists(key)).toBe(true);
  });
});
