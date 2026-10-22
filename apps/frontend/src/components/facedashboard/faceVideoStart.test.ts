import { describe, expect, it } from "vitest";
import type { CompletePersonFace } from "../../api_client/faces/types";
import { faceVideoStart, withFaceVideoStart } from "./faceVideoStart";

const anna: CompletePersonFace = {
  id: 1,
  name: "Anna",
  kind: "USER",
  face_count: 2,
  faces: [
    { id: 10, photo: "video", video_time: 42 },
    { id: 11, photo: "photo", video_time: null },
  ],
};
const cluster: CompletePersonFace = {
  id: 2,
  name: "Unknown 001",
  kind: "CLUSTER",
  face_count: 1,
  faces: [{ id: 20, photo: "video", video_time: 80 }],
};

describe("opening a video at a face (#2762)", () => {
  it("starts at the face, with its person's name", () => {
    expect(faceVideoStart([anna, cluster], { id: 10, photo: "video", video_time: 42 })).toEqual({
      photoId: "video",
      start: { seconds: 42, name: "Anna" },
    });
  });

  it("names no one for a cluster", () => {
    expect(faceVideoStart([anna, cluster], { id: 20, photo: "video", video_time: 80 })).toEqual({
      photoId: "video",
      start: { seconds: 80 },
    });
  });

  it("has no start for a photo's face", () => {
    expect(faceVideoStart([anna], { id: 11, photo: "photo", video_time: null })).toBeNull();
  });

  it("gives every entry of that video the clicked face's start, and nothing else", () => {
    const items = [
      { id: "video", image_hash: "v" },
      { id: "photo", image_hash: "p" },
      { id: "video", image_hash: "v" },
    ];
    const opened = { photoId: "video", start: { seconds: 80 } };

    expect(withFaceVideoStart(items, opened).map(item => item.videoStart)).toEqual([
      { seconds: 80 },
      undefined,
      { seconds: 80 },
    ]);
    expect(withFaceVideoStart(items, null)).toBe(items);
  });
});
