/**
 * The one list of edits that "Write edits to files" writes (#2281). It must say what
 * api/metadata/photo_writer.py writes: rating, date and rotation in both modes, nothing when Off,
 * and never caption, tags or location (#2289, #2290).
 */
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { fieldsNeverWritten, listFields, writeDestination, writeModeOf, WRITTEN_FIELDS } from "./metadataWrite";

describe("WRITTEN_FIELDS", () => {
  it("matches what the backend writes in each mode", () => {
    expect(WRITTEN_FIELDS).toEqual({
      OFF: [],
      SIDECAR_FILE: ["rating", "date", "rotation"],
      MEDIA_FILE: ["rating", "date", "rotation"],
    });
  });

  it("leaves captions, tags and locations unwritten", () => {
    expect(fieldsNeverWritten()).toEqual(["caption", "tags", "location"]);
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

  it("keeps a field no mode writes in LibrePhotos", () => {
    expect(writeDestination("caption", "MEDIA_FILE")).toBe("none");
    expect(writeDestination("tags", "SIDECAR_FILE")).toBe("none");
    expect(writeDestination("location", "MEDIA_FILE")).toBe("none");
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
