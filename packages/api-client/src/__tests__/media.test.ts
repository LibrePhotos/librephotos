import { describe, expect, it } from "vitest";
import {
  bigThumbnailUrl,
  embeddedMediaUrl,
  faceUrl,
  photoUrl,
  squarePosterUrl,
  squareThumbnailUrl,
  videoUrl,
  zipUrl,
} from "../media";

describe("media URL builders", () => {
  it.each([
    [squareThumbnailUrl, "/media/square_thumbnails/abc"],
    [squarePosterUrl, "/media/square_thumbnails/abc.webp"],
    [bigThumbnailUrl, "/media/thumbnails_big/abc"],
    [photoUrl, "/media/photos/abc"],
    [videoUrl, "/media/photos/abc.mp4"],
    [embeddedMediaUrl, "/media/embedded_media/abc"],
    [faceUrl, "/media/faces/abc"],
    [zipUrl, "/media/zip/abc"],
  ])("%o builds %s under the server address", (build, path) => {
    expect(build("", "abc")).toBe(path);
    expect(build("/librephotos", "abc")).toBe(`/librephotos${path}`);
    expect(build("https://photos.example/", "abc")).toBe(`https://photos.example${path}`);
  });
});
