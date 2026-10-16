/**
 * The event page's grid: one group per day of the time-sorted photos, each photo a tile with the
 * play badge for a video and the defaults an older backend leaves out.
 */
import { Media, type PhotoSimple } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import { eventGridPhoto, eventPhotoGroups } from "./eventGrid";

const photo = (id: string, exif_timestamp: string, extra: Partial<PhotoSimple> = {}): PhotoSimple => ({
  id,
  square_thumbnail: "",
  image_hash: `hash-${id}`,
  exif_timestamp,
  exif_gps_lat: null,
  exif_gps_lon: null,
  rating: 0,
  geolocation_json: null,
  public: false,
  video: false,
  ...extra,
});

describe("eventPhotoGroups", () => {
  it("groups the photos by day, in their order", () => {
    const groups = eventPhotoGroups([
      photo("a", "2025-03-12T15:00:00Z"),
      photo("b", "2025-03-12T16:30:00Z"),
      photo("c", "2025-03-13T09:00:00Z"),
    ]);
    expect(groups.map(group => [group.date, group.items.map(item => item.id)])).toEqual([
      ["2025-03-12", ["a", "b"]],
      ["2025-03-13", ["c"]],
    ]);
  });
});

describe("eventGridPhoto", () => {
  it("fills what an older backend leaves out", () => {
    const tile = eventGridPhoto(photo("a", "2025-03-12T15:00:00Z"));
    expect(tile).toMatchObject({ type: Media.IMAGE, aspectRatio: 1, dominantColor: "", is_hdr: false });
  });

  it("keeps what the backend sends, and marks a video", () => {
    const tile = eventGridPhoto(
      photo("v", "2025-03-12T15:00:00Z", { video: true, aspectRatio: 1.5, dominantColor: "#123456", is_hdr: true })
    );
    expect(tile).toMatchObject({ type: Media.VIDEO, aspectRatio: 1.5, dominantColor: "#123456", is_hdr: true });
    expect(tile.image_hash).toBe("hash-v");
  });
});
