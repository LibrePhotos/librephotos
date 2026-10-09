/**
 * The public photo page decides from `video_playback_type` whether the browser
 * can play a shared video at all (the public endpoint never transcodes). zod
 * strips keys a schema does not list, so without the field the page never saw it.
 */
import { describe, expect, it } from "vitest";
import { SharedPhoto } from "./usePhotoShareMutation";

const sharedVideo = {
  video: true,
  thumbnail_url: "/api/public/photo/abc/media/thumbnail/",
  video_url: "/api/public/photo/abc/media/video/",
};

describe("SharedPhoto", () => {
  it("keeps the video's playback type", () => {
    const type = 'video/mp4; codecs="hvc1.2.4.L120.90"';
    expect(SharedPhoto.parse({ ...sharedVideo, video_playback_type: type }).video_playback_type).toBe(type);
  });

  it("accepts null for stills and unprobed videos, and older backends without the field", () => {
    expect(SharedPhoto.parse({ ...sharedVideo, video_playback_type: null }).video_playback_type).toBeNull();
    expect(SharedPhoto.parse(sharedVideo).video_playback_type).toBeUndefined();
  });
});
