import type { ParseKeys, TFunction } from "i18next";
import { z } from "zod";
import { escapePattern, MAX_TEXT_LENGTH, parseDatePattern, type DatePatternProblem } from "./dateRuleForm";

const PATTERN_MESSAGES: Record<DatePatternProblem, ParseKeys> = {
  length: "daterules.date_pattern_length",
  missing: "daterules.date_pattern_missing",
  repeated: "daterules.date_pattern_repeated",
};

type Values = z.infer<ReturnType<typeof formFields>>;
type Issue = { path: keyof Values; message: string };

function formFields() {
  return z.object({
    source: z.enum(["exif", "path", "filesystem"]),
    exifTag: z.string(),
    fileNamePattern: z.enum(["default", "whatsapp", "custom"]),
    datePattern: z.string(),
    fullPath: z.boolean(),
    fileProperty: z.enum(["mtime", "ctime"]),
    recordedInUtc: z.boolean(),
    reportZone: z.enum(["gps_timezonefinder", "user_default", "named"]),
    zoneName: z.string(),
    conditionPath: z.string(),
    conditionFilename: z.string(),
    conditionTag: z.string(),
    conditionTagText: z.string(),
    name: z.string(),
  });
}

function sourceIssues(values: Values, t: TFunction, dateTags: readonly string[]): Issue[] {
  if (values.source === "exif" && !dateTags.includes(values.exifTag)) {
    return [{ path: "exifTag", message: t("daterules.tag_required") }];
  }
  if (values.source !== "path" || values.fileNamePattern !== "custom") return [];
  const parsed = parseDatePattern(values.datePattern);
  return typeof parsed === "string" ? [{ path: "datePattern", message: t(PATTERN_MESSAGES[parsed]) }] : [];
}

function tooLong(text: string): boolean {
  return escapePattern(text).length > MAX_TEXT_LENGTH;
}

function conditionIssues(values: Values, t: TFunction): Issue[] {
  const issues: Issue[] = [];
  const long = t("daterules.condition_too_long");
  if (tooLong(values.conditionPath)) issues.push({ path: "conditionPath", message: long });
  if (tooLong(values.conditionFilename)) issues.push({ path: "conditionFilename", message: long });
  if (values.conditionTagText && !values.conditionTag) {
    issues.push({ path: "conditionTag", message: t("daterules.condition_tag_required") });
  }
  if (values.conditionTag && !values.conditionTagText) {
    issues.push({ path: "conditionTagText", message: t("daterules.condition_text_required") });
  } else if (tooLong(values.conditionTagText)) {
    issues.push({ path: "conditionTagText", message: long });
  }
  return issues;
}

function otherIssues(values: Values, t: TFunction): Issue[] {
  const issues: Issue[] = [];
  if (values.recordedInUtc && values.reportZone === "named" && !values.zoneName) {
    issues.push({ path: "zoneName", message: t("daterules.zone_name_required") });
  }
  const name = values.name.trim();
  if (!name) issues.push({ path: "name", message: t("daterules.name_required") });
  if (name.length > MAX_TEXT_LENGTH) issues.push({ path: "name", message: t("daterules.name_too_long") });
  return issues;
}

/**
 * The custom date rule form (#2272). The server checks the rule again before it is saved
 * (api/metadata/date_rule_checks.py); this catches what it would refuse before asking. `dateTags`
 * are the tags a rule may read (GET /api/datetime-rules/options/).
 */
export function makeDateRuleFormSchema(t: TFunction, dateTags: readonly string[]) {
  return formFields().superRefine((values, ctx) => {
    for (const issue of [
      ...sourceIssues(values, t, dateTags),
      ...conditionIssues(values, t),
      ...otherIssues(values, t),
    ]) {
      ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
    }
  });
}
