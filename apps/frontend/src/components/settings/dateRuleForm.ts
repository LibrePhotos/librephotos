// The custom date rule form (#2272): its values, and the rule object they stand for. The rule is
// what the backend's TimeExtractionRule reads (api/metadata/datetime_rules.py); the server checks
// it again before it is saved (api/metadata/date_rule_checks.py).
import type { DateTimeRule } from "@librephotos/api-client";
import type { TFunction } from "i18next";
import { DateTime } from "luxon";

export type RuleSource = "exif" | "path" | "filesystem";
type FileNamePattern = "default" | "whatsapp" | "custom";
type ReportZone = "gps_timezonefinder" | "user_default" | "named";
type FileProperty = "mtime" | "ctime";

export type DateRuleFormValues = {
  source: RuleSource;
  exifTag: string;
  fileNamePattern: FileNamePattern;
  datePattern: string;
  fullPath: boolean;
  fileProperty: FileProperty;
  /** The rule reads UTC and converts it to `reportZone`; else it reads local time as it is. */
  recordedInUtc: boolean;
  reportZone: ReportZone;
  zoneName: string;
  conditionPath: string;
  conditionFilename: string;
  conditionTag: string;
  conditionTagText: string;
  name: string;
};

const ZONE_PREFIX = "name:";
// The longest condition the server takes, escaped (date_rule_checks.MAX_TEXT_LENGTH).
export const MAX_TEXT_LENGTH = 200;

export function emptyFormValues(): DateRuleFormValues {
  return {
    source: "exif",
    exifTag: "",
    fileNamePattern: "custom",
    datePattern: "YYYY-MM-DD HH.mm.ss",
    fullPath: false,
    fileProperty: "mtime",
    recordedInUtc: false,
    reportZone: "gps_timezonefinder",
    zoneName: "",
    conditionPath: "",
    conditionFilename: "",
    conditionTag: "",
    conditionTagText: "",
    name: "",
  };
}

/* ---- plain text conditions --------------------------------------------- */

const SPECIAL = /[.*+?^${}()|[\]\\]/g;

/** `text` as an expression that matches exactly it, which the server accepts as a condition. */
export function escapePattern(text: string): string {
  return text.replace(SPECIAL, "\\$&");
}

/** A condition saved as escaped text, read back as the text. */
export function unescapePattern(pattern: string): string {
  return pattern.replace(/\\(.)/g, "$1");
}

/* ---- file name date patterns (api/metadata/date_patterns.py) ------------ */

const PLACEHOLDERS: Readonly<Record<string, readonly [DatePart, number]>> = {
  YYYY: ["year", 4],
  MM: ["month", 2],
  DD: ["day", 2],
  HH: ["hour", 2],
  mm: ["minute", 2],
  ss: ["second", 2],
};
type DatePart = "year" | "month" | "day" | "hour" | "minute" | "second";
const TOKEN = /YYYY|MM|DD|HH|mm|ss|\?/y;
const MAX_PATTERN_LENGTH = 64;

export type DatePatternProblem = "length" | "missing" | "repeated";
export type ParsedDatePattern = { regexp: RegExp; parts: DatePart[] };

function patternProblem(parts: DatePart[]): DatePatternProblem | null {
  if (!parts.includes("year") || !parts.includes("month") || !parts.includes("day")) return "missing";
  return new Set(parts).size === parts.length ? null : "repeated";
}

/** `pattern` as the expression the server builds from it, or why it cannot be used. */
export function parseDatePattern(pattern: string): ParsedDatePattern | DatePatternProblem {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) return "length";
  const parts: DatePart[] = [];
  let source = "";
  let position = 0;
  while (position < pattern.length) {
    TOKEN.lastIndex = position;
    const token = TOKEN.exec(pattern)?.[0];
    const placeholder = token === undefined ? undefined : PLACEHOLDERS[token];
    if (placeholder) {
      parts.push(placeholder[0]);
      source += `(\\d{${placeholder[1]}})`;
    } else {
      source += token === "?" ? "." : escapePattern(pattern.charAt(position));
    }
    position += token?.length ?? 1;
  }
  return patternProblem(parts) ?? { regexp: new RegExp(source), parts };
}

/**
 * The date `pattern` reads from `name`, as the date and time a scan would give the photo, in the UI
 * language; null where it finds none, or one that cannot be (a 13th month).
 */
export function readDatePattern(pattern: ParsedDatePattern, name: string): string | null {
  const match = pattern.regexp.exec(name);
  if (!match) return null;
  const parts: Partial<Record<DatePart, number>> = {};
  pattern.parts.forEach((part, index) => {
    parts[part] = Number(match[index + 1]);
  });
  const read = DateTime.fromObject(parts, { zone: "utc" });
  return read.isValid ? read.toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS) : null;
}

/* ---- rule <-> form values ----------------------------------------------- */

function zoneOf(report: string | undefined): Pick<DateRuleFormValues, "reportZone" | "zoneName"> {
  if (report?.startsWith(ZONE_PREFIX)) return { reportZone: "named", zoneName: report.slice(ZONE_PREFIX.length) };
  return { reportZone: report === "user_default" ? "user_default" : "gps_timezonefinder", zoneName: "" };
}

function conditionsOf(rule: DateTimeRule): Partial<DateRuleFormValues> {
  const [tag = "", text = ""] = rule.condition_exif?.split(/\/\/(.*)/s) ?? [];
  return {
    conditionPath: unescapePattern(rule.condition_path ?? ""),
    conditionFilename: unescapePattern(rule.condition_filename ?? ""),
    conditionTag: tag,
    conditionTagText: unescapePattern(text),
  };
}

function sourceOf(rule: DateTimeRule): Partial<DateRuleFormValues> {
  switch (rule.rule_type) {
    case "exif":
      return { source: "exif", exifTag: rule.exif_tag };
    case "path": {
      const fileNamePattern = rule.date_pattern
        ? "custom"
        : rule.predefined_regexp === "whatsapp"
          ? "whatsapp"
          : "default";
      return {
        source: "path",
        fileNamePattern,
        datePattern: rule.date_pattern ?? emptyFormValues().datePattern,
        fullPath: rule.path_part === "full_path",
      };
    }
    case "filesystem":
      return { source: "filesystem", fileProperty: rule.file_property };
    case "user_defined":
    case "takeout_json":
      return {};
  }
}

/** The form for `rule`: to edit a custom rule, or to start a copy of a predefined one. */
export function ruleToFormValues(rule: DateTimeRule): DateRuleFormValues {
  return {
    ...emptyFormValues(),
    ...sourceOf(rule),
    recordedInUtc: Boolean(rule.transform_tz),
    ...zoneOf(rule.report_tz),
    ...conditionsOf(rule),
    name: rule.name,
  };
}

/** Whether the rule form can show `rule`: rules of the three kinds it writes. */
export function isEditableKind(rule: DateTimeRule): boolean {
  return rule.rule_type === "exif" || rule.rule_type === "path" || rule.rule_type === "filesystem";
}

type PathParams = { date_pattern?: string; predefined_regexp?: string; path_part?: "full_path" };

function pathParams(values: DateRuleFormValues): PathParams {
  const params: PathParams = {};
  if (values.fileNamePattern === "custom") params.date_pattern = values.datePattern;
  if (values.fileNamePattern === "whatsapp") params.predefined_regexp = "whatsapp";
  if (values.fullPath) params.path_part = "full_path";
  return params;
}

type ZoneParams = { transform_tz?: number; source_tz?: string; report_tz?: string };

function zoneParams(values: DateRuleFormValues): ZoneParams {
  if (!values.recordedInUtc) return {};
  const report = values.reportZone === "named" ? `${ZONE_PREFIX}${values.zoneName}` : values.reportZone;
  return { transform_tz: 1, source_tz: "utc", report_tz: report };
}

type ConditionParams = { condition_path?: string; condition_filename?: string; condition_exif?: string };

function conditionParams(values: DateRuleFormValues): ConditionParams {
  const params: ConditionParams = {};
  if (values.conditionPath) params.condition_path = escapePattern(values.conditionPath);
  if (values.conditionFilename) params.condition_filename = escapePattern(values.conditionFilename);
  if (values.conditionTag) params.condition_exif = `${values.conditionTag}//${escapePattern(values.conditionTagText)}`;
  return params;
}

/** The custom rule `values` stand for, with the id `id`. */
export function formValuesToRule(values: DateRuleFormValues, id: number): DateTimeRule {
  const base = { id, name: values.name.trim(), custom: true, ...zoneParams(values), ...conditionParams(values) };
  switch (values.source) {
    case "exif":
      return { ...base, rule_type: "exif", exif_tag: values.exifTag };
    case "path":
      return { ...base, rule_type: "path", ...pathParams(values) };
    case "filesystem":
      return { ...base, rule_type: "filesystem", file_property: values.fileProperty };
  }
}

/** Whether `rule` is one the rule form wrote (and so may edit): the predefined ones stay as they are. */
export function isCustomRule(rule: DateTimeRule, firstCustomId: number): boolean {
  return rule.custom === true || rule.id >= firstCustomId;
}

/** The id a new custom rule gets: past every id in the saved list, and at least `firstCustomId`. */
export function nextCustomId(ids: readonly unknown[], firstCustomId: number): number {
  const numbers = ids.filter((id): id is number => typeof id === "number" && Number.isFinite(id));
  return Math.max(firstCustomId, ...numbers.map(id => id + 1));
}

/* ---- the name the choices suggest ------------------------------------- */

function zoneLabel(values: DateRuleFormValues, t: TFunction<"translation", undefined>): string {
  switch (values.reportZone) {
    case "gps_timezonefinder":
      return t("rules.tz_names.gps_timezonefinder");
    case "user_default":
      return t("rules.tz_names.user_default");
    case "named":
      return values.zoneName;
  }
}

function sourceLabel(values: DateRuleFormValues, t: TFunction<"translation", undefined>): string {
  switch (values.source) {
    case "exif":
      return values.exifTag;
    case "path":
      if (values.fileNamePattern === "custom")
        return t("daterules.suggested_path_pattern", { pattern: values.datePattern });
      return values.fileNamePattern === "whatsapp" ? t("daterules.suggested_whatsapp") : t("daterules.suggested_path");
    case "filesystem":
      return values.fileProperty === "mtime"
        ? t("daterules.suggested_filesystem_mtime")
        : t("daterules.suggested_filesystem_ctime");
  }
}

/** The name the form fills in from the choices, until the user writes their own. */
export function suggestedName(values: DateRuleFormValues, t: TFunction<"translation", undefined>): string {
  if (values.source === "exif" && !values.exifTag) return "";
  const source = sourceLabel(values, t);
  if (values.recordedInUtc) return t("daterules.suggested_utc", { source, zone: zoneLabel(values, t) });
  return values.source === "exif" ? t("daterules.suggested_exif_local", { tag: source }) : source;
}
