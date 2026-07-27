import { photoRoute, seedSlideFromParams } from "./route";

/**
 * The grid already knows how to draw the photo it was just tapped on. Handing
 * that over as route params is what lets the viewer paint on its first frame
 * instead of querying the mirror for something the caller already had.
 */
describe("photoRoute", () => {
  it("keeps the hash as the route id for a server-backed photo", () => {
    const route = photoRoute({
      key: "photo-1",
      photoId: "photo-1",
      imageHash: "hashA",
      type: "image",
      localUri: null,
    });
    expect(route.pathname).toBe("/photo/[id]");
    expect(route.params).toEqual({ id: "hashA", sh: "hashA", st: "image", sr: "photo-1" });
  });

  /**
   * A camera-roll asset has no hash until it is hashed. Routing on the tile key
   * is what stopped the tap being swallowed; carrying the `ph://` uri is what
   * lets it render with no server round-trip at all.
   */
  it("routes an unhashed camera-roll asset by its own id and carries its uri", () => {
    const route = photoRoute({
      key: "L1",
      photoId: null,
      imageHash: null,
      type: "image",
      localUri: "ph://L1",
    });
    expect(route.params).toEqual({ id: "L1", su: "ph://L1", st: "image", sl: "L1" });
  });

  it("carries nothing it does not have", () => {
    expect(photoRoute({ key: "k" }).params).toEqual({ id: "k" });
  });
});

describe("seedSlideFromParams", () => {
  it("rebuilds the tapped slide from the params the grid sent", () => {
    expect(seedSlideFromParams({ id: "hashA", sh: "hashA", st: "video", sr: "photo-1" })).toEqual({
      key: "photo-1",
      remote_id: "photo-1",
      local_id: null,
      image_hash: "hashA",
      local_uri: null,
      type: "video",
    });
  });

  it("rebuilds a camera-roll slide", () => {
    expect(seedSlideFromParams({ id: "L1", su: "ph://L1", sl: "L1", st: "image" })).toEqual({
      key: "L1",
      remote_id: null,
      local_id: "L1",
      image_hash: null,
      local_uri: "ph://L1",
      type: "image",
    });
  });

  /** A deep link or a notification carries only an id — nothing to draw yet. */
  it("is null when the params carry nothing renderable", () => {
    expect(seedSlideFromParams({ id: "hashA" })).toBeNull();
    expect(seedSlideFromParams({})).toBeNull();
  });
});
