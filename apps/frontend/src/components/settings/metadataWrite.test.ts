/**
 * The one list of edits that "Write edits to files" writes (#2281). It must say what
 * api/metadata/photo_writer.py writes: rating, date, rotation, caption, tags (#2289), location and
 * rights (#425) in both modes, nothing when Off.
 */
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { listFields, writeDestination, writeModeOf, WRITTEN_FIELDS } from "./metadataWrite";

describe("WRITTEN_FIELDS", () => {
  it("matches what the backend writes in each mode", () => {
    expect(WRITTEN_FIELDS).toEqual({
      OFF: [],
      SIDECAR_FILE: ["rating", "date", "rotation", "caption", "tags", "location", "rights"],
      MEDIA_FILE: ["rating", "date", "rotation", "caption", "tags", "location", "rights"],
    });
  });
});

describe("writeModeOf", () => {
  it("keeps the two writing modes", () => {
    expect(writeModeOf("SIDECAR_FILE")).toBe("SIDECAR_FILE");
    expect(writeModeOf("MEDIA_FILE")).toBe("MEDIA_FILE");
  });

  it("reads Off and anything unknown as Off, like the server", () => {
    expect(writeModeOf("OFF")).toBe("OFF");
    expect(writeModeOf("SOMETHING_NEW")).toBe("OFF");
  });
});

describe("writeDestination", () => {
  it("sends a written field to the sidecar or the photo file", () => {
    expect(writeDestination("date", "SIDECAR_FILE")).toBe("sidecar");
    expect(writeDestination("date", "MEDIA_FILE")).toBe("file");
  });

  it("keeps everything in LibrePhotos while Off", () => {
    expect(writeDestination("date", "OFF")).toBe("none");
  });

  it("writes captions and locations like the other fields", () => {
    expect(writeDestination("caption", "MEDIA_FILE")).toBe("file");
    expect(writeDestination("location", "SIDECAR_FILE")).toBe("sidecar");
  });

  it("writes tags as the file's keywords (#2289)", () => {
    expect(writeDestination("tags", "SIDECAR_FILE")).toBe("sidecar");
    expect(writeDestination("tags", "MEDIA_FILE")).toBe("file");
    expect(writeDestination("tags", "OFF")).toBe("none");
  });
});

describe("listFields", () => {
  const t: TFunction = i18n.getFixedT("en");

  it("lists the fields the way the language does", () => {
    expect(listFields(["rating", "date", "rotation"], t, "en")).toBe("ratings, dates, and rotations");
    expect(listFields(["caption"], t, "en")).toBe("captions");
  });

  it("falls back to English list rules for an unknown language tag", () => {
    expect(listFields(["tags", "location"], t, "not a language")).toBe("tags and locations");
  });
});
