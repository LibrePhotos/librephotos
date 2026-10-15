import type { RawMetadataFile } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  allGroups,
  buildRows,
  fileAsJson,
  fileNameOfLabel,
  formatTagValue,
  initiallyCollapsed,
  tagCount,
} from "./metadataRows";

const file: RawMetadataFile = {
  path_label: "2024/DSCF4127.JPG",
  kind: "media",
  groups: [
    { name: "IFD0", family: "EXIF", tags: { Make: "FUJIFILM", ModifyDate: "2024:08:17 20:41:12" } },
    { name: "ExifIFD", family: "EXIF", tags: { DateTimeOriginal: "2024:08:17 20:41:12", ISO: "200" } },
    { name: "IFD1", family: "EXIF", tags: { ThumbnailImage: "(Binary data 9214 bytes, use -b option to extract)" } },
    { name: "FujiFilm", family: "MakerNotes", tags: { FilmMode: "Classic Chrome", Quality: "FINE" } },
  ],
};

const kinds = (rows: ReturnType<typeof buildRows>["rows"]) =>
  rows.map(row => (row.type === "group" ? `[${row.name}]` : row.fullName));

describe("buildRows", () => {
  it("lists each group's header and its tags, leaving collapsed groups closed", () => {
    const table = buildRows(file, "", new Set(["FujiFilm"]));
    expect(kinds(table.rows)).toEqual([
      "[IFD0]",
      "IFD0:Make",
      "IFD0:ModifyDate",
      "[ExifIFD]",
      "ExifIFD:DateTimeOriginal",
      "ExifIFD:ISO",
      "[IFD1]",
      "IFD1:ThumbnailImage",
      "[FujiFilm]",
    ]);
    expect(table.total).toBe(7);
    expect(table.matching).toBe(7);
  });

  it("narrows to tags whose group, name or value match, any case, opening collapsed groups", () => {
    const table = buildRows(file, "  DATE ", new Set(["IFD0"]));
    expect(kinds(table.rows)).toEqual(["[IFD0]", "IFD0:ModifyDate", "[ExifIFD]", "ExifIFD:DateTimeOriginal"]);
    expect(table.matching).toBe(2);
    expect(table.rows[0]).toMatchObject({ type: "group", total: 2, matching: 1, collapsed: false });
  });

  it("matches values and the group name", () => {
    expect(kinds(buildRows(file, "chrome", new Set()).rows)).toEqual(["[FujiFilm]", "FujiFilm:FilmMode"]);
    expect(buildRows(file, "fujifilm:", new Set()).matching).toBe(2);
  });

  it("marks ExifTool's binary placeholder", () => {
    const thumbnail = buildRows(file, "thumbnail", new Set()).rows[1];
    expect(thumbnail).toMatchObject({ type: "tag", binary: true });
  });

  it("has no rows when nothing matches", () => {
    expect(buildRows(file, "iptc", new Set()).rows).toEqual([]);
  });
});

describe("formatTagValue", () => {
  it("keeps text, joins plain lists and writes structures as JSON", () => {
    expect(formatTagValue("1/250")).toBe("1/250");
    expect(formatTagValue(3)).toBe("3");
    expect(formatTagValue(true)).toBe("true");
    expect(formatTagValue(null)).toBe("");
    expect(formatTagValue(["Algarve", "Portugal"])).toBe("Algarve, Portugal");
    expect(formatTagValue({ RegionList: [{ Name: "Anna" }] })).toBe('{"RegionList":[{"Name":"Anna"}]}');
    expect(formatTagValue([{ Name: "Anna" }])).toBe('[{"Name":"Anna"}]');
  });
});

describe("file helpers", () => {
  it("collapses maker notes first and can collapse every group", () => {
    expect([...initiallyCollapsed(file)]).toEqual(["FujiFilm"]);
    expect([...allGroups(file)]).toEqual(["IFD0", "ExifIFD", "IFD1", "FujiFilm"]);
  });

  it("counts the tags and names the file", () => {
    expect(tagCount(file)).toBe(7);
    expect(fileNameOfLabel(file.path_label)).toBe("DSCF4127.JPG");
    expect(fileNameOfLabel("IMG.jpg")).toBe("IMG.jpg");
  });

  it("writes the file as ExifTool's -json -G1 would", () => {
    const json = z.record(z.string(), z.unknown()).parse(JSON.parse(fileAsJson(file)));
    expect(json).toMatchObject({
      SourceFile: "2024/DSCF4127.JPG",
      "IFD0:Make": "FUJIFILM",
      "FujiFilm:FilmMode": "Classic Chrome",
    });
    expect(Object.keys(json)).toHaveLength(8);
  });
});
