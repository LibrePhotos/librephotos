/** The custom date rule form's values and the rule they stand for (#2272). */
import type { DateTimeRule } from "@librephotos/api-client";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import {
  emptyFormValues,
  escapePattern,
  formValuesToRule,
  isCustomRule,
  isEditableKind,
  nextCustomId,
  parseDatePattern,
  readDatePattern,
  ruleToFormValues,
  suggestedName,
  unescapePattern,
} from "./dateRuleForm";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

function parsed(pattern: string) {
  const result = parseDatePattern(pattern);
  if (typeof result === "string") throw new Error(`${pattern}: ${result}`);
  return result;
}

describe("file name date patterns", () => {
  it("reads the date where the pattern matches, like the server", () => {
    expect(readDatePattern(parsed("DD?MM?YYYY"), "scan 09_03.2021.tif")).toMatch(/^Mar 9, 2021, 12:00:00\sAM$/);
    expect(readDatePattern(parsed("YYYYMMDD_HHmmss"), "IMG_20230101_120005.jpg")).toMatch(/12:00:05\sPM$/);
  });

  it("finds no date where the name has none, or one that cannot be", () => {
    expect(readDatePattern(parsed("YYYY-MM-DD"), "IMG_0001.jpg")).toBeNull();
    expect(readDatePattern(parsed("YYYY-MM-DD"), "2023-13-01.jpg")).toBeNull();
  });

  it("takes special characters as themselves", () => {
    expect(readDatePattern(parsed("(YYYY).MM.DD"), "x(2020).01.02")).not.toBeNull();
    expect(readDatePattern(parsed("(YYYY).MM.DD"), "x2020a01b02")).toBeNull();
  });

  it("says why a pattern cannot be used", () => {
    expect(parseDatePattern("")).toBe("length");
    expect(parseDatePattern("Y".repeat(65))).toBe("length");
    expect(parseDatePattern("MM-DD HH")).toBe("missing");
    expect(parseDatePattern("YYYY-MM-DD-DD")).toBe("repeated");
  });
});

describe("plain text conditions", () => {
  it("escape and read back", () => {
    const text = "Trip (2) [x] a.b*c+d?e^f$g{h}i|j\\k";
    expect(new RegExp(escapePattern(text)).test(`in ${text} here`)).toBe(true);
    expect(unescapePattern(escapePattern(text))).toBe(text);
  });
});

describe("form values and rules", () => {
  it("builds a file-name rule with conditions and a named time zone, and reads it back", () => {
    const values = {
      ...emptyFormValues(),
      source: "path" as const,
      datePattern: "YYYY-MM-DD",
      fullPath: true,
      recordedInUtc: true,
      reportZone: "named" as const,
      zoneName: "Europe/Berlin",
      conditionPath: "Moscow_Visit",
      conditionTag: "EXIF:Model",
      conditionTagText: "iPhone 15 (Pro)",
      name: " From Moscow ",
    };

    const rule = formValuesToRule(values, 1004);

    expect(rule).toEqual({
      id: 1004,
      name: "From Moscow",
      custom: true,
      rule_type: "path",
      date_pattern: "YYYY-MM-DD",
      path_part: "full_path",
      transform_tz: 1,
      source_tz: "utc",
      report_tz: "name:Europe/Berlin",
      condition_path: "Moscow_Visit",
      condition_exif: "EXIF:Model//iPhone 15 \\(Pro\\)",
    });
    expect(ruleToFormValues(rule)).toEqual({ ...values, name: "From Moscow" });
  });

  it("builds file time and WhatsApp rules", () => {
    const fileTime = { ...emptyFormValues(), source: "filesystem" as const, fileProperty: "ctime" as const, name: "x" };
    expect(formValuesToRule(fileTime, 1000)).toEqual({
      id: 1000,
      name: "x",
      custom: true,
      rule_type: "filesystem",
      file_property: "ctime",
    });
    const whatsapp = { ...emptyFormValues(), source: "path" as const, fileNamePattern: "whatsapp" as const, name: "w" };
    expect(formValuesToRule(whatsapp, 1000)).toMatchObject({ rule_type: "path", predefined_regexp: "whatsapp" });
    expect(formValuesToRule(whatsapp, 1000)).not.toHaveProperty("date_pattern");
  });

  it("reads a predefined rule into the form, for a copy", () => {
    const video: DateTimeRule = {
      id: 4,
      name: "Video",
      rule_type: "exif",
      exif_tag: "QuickTime:CreateDate",
      transform_tz: 1,
      source_tz: "utc",
      report_tz: "user_default",
      is_default: true,
    };
    expect(ruleToFormValues(video)).toMatchObject({
      source: "exif",
      exifTag: "QuickTime:CreateDate",
      recordedInUtc: true,
      reportZone: "user_default",
    });
    const filename: DateTimeRule = { id: 3, name: "Name", rule_type: "path" };
    expect(ruleToFormValues(filename)).toMatchObject({ source: "path", fileNamePattern: "default" });
    expect(ruleToFormValues({ ...filename, predefined_regexp: "whatsapp" }).fileNamePattern).toBe("whatsapp");
    expect(isEditableKind({ id: 20, name: "Takeout", rule_type: "takeout_json" })).toBe(false);
    expect(isEditableKind(video)).toBe(true);
  });

  it("tells custom rules from predefined ones, and gives a new one the next id", () => {
    expect(isCustomRule({ id: 1, name: "x", rule_type: "path" }, 1000)).toBe(false);
    expect(isCustomRule({ id: 1000, name: "x", rule_type: "path" }, 1000)).toBe(true);
    expect(isCustomRule({ id: 5, name: "x", rule_type: "path", custom: true }, 1000)).toBe(true);
    expect(nextCustomId([1, 16, "3", null], 1000)).toBe(1000);
    expect(nextCustomId([1, 1000, 1003], 1000)).toBe(1004);
  });

  it("suggests a name from the choices", () => {
    const t = i18n.t;
    expect(suggestedName(emptyFormValues(), t)).toBe("");
    expect(suggestedName({ ...emptyFormValues(), exifTag: "EXIF:CreateDate" }, t)).toBe(
      "Local time from EXIF:CreateDate"
    );
    const named = { ...emptyFormValues(), source: "filesystem" as const, recordedInUtc: true };
    expect(suggestedName({ ...named, reportZone: "named", zoneName: "Asia/Tokyo" }, t)).toBe(
      "File modified time in UTC, converted to Asia/Tokyo"
    );
    expect(suggestedName({ ...named, recordedInUtc: false, fileProperty: "ctime" }, t)).toBe("File created time");
    expect(suggestedName({ ...emptyFormValues(), source: "path", datePattern: "YYYYMMDD" }, t)).toBe(
      "Date in the file name (YYYYMMDD)"
    );
    expect(suggestedName({ ...emptyFormValues(), source: "path", fileNamePattern: "default" }, t)).toBe(
      "Date in the file name"
    );
    expect(suggestedName({ ...emptyFormValues(), source: "path", fileNamePattern: "whatsapp" }, t)).toBe(
      "Date in a WhatsApp file name"
    );
    expect(suggestedName({ ...named, reportZone: "user_default", exifTag: "" }, t)).toBe(
      "File modified time in UTC, converted to your default timezone"
    );
  });
});
