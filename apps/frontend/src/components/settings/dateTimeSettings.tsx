import type { DateTimeRule } from "@librephotos/api-client";
import type { ParseKeys, TFunction } from "i18next";
import React from "react";
import { unescapePattern } from "./dateRuleForm";

const RULE_TYPE_NAME_KEYS: Partial<Record<string, ParseKeys>> = {
  exif: "rules.rule_type_names.exif",
  path: "rules.rule_type_names.path",
  filesystem: "rules.rule_type_names.filesystem",
  user_defined: "rules.rule_type_names.user_defined",
  takeout_json: "rules.rule_type_names.takeout_json",
};

/** "exif", "path", ... as words; an unknown type shows as it is. */
export function describeRuleType(ruleType: string, t: TFunction<"translation", undefined>) {
  const key = RULE_TYPE_NAME_KEYS[ruleType];
  return key ? t(key) : ruleType;
}

type RuleValue = string | number | boolean | null | undefined;

/**
 * A rule param as the list shows it. A rule keeps the keys the schema does not know, so a param
 * can be any JSON value: a list or an object shows as its JSON (React cannot render an object).
 */
function ruleValue(value: unknown): RuleValue {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return JSON.stringify(value);
}

const TIMEZONE_NAME_KEYS: Partial<Record<string, ParseKeys>> = {
  gps_timezonefinder: "rules.tz_names.gps_timezonefinder",
  user_default: "rules.tz_names.user_default",
  server_local: "rules.tz_names.server_local",
};

/** A timezone description as the backend's _get_tz reads it: "utc", "name:<tz>" or a keyword. */
function describeTimezone(value: RuleValue, t: TFunction<"translation", undefined>): RuleValue {
  if (typeof value !== "string") return value;
  if (value.startsWith("name:")) return value.slice("name:".length);
  if (value.toLowerCase() === "utc") return "UTC";
  const key = TIMEZONE_NAME_KEYS[value];
  return key ? t(key) : value;
}

const TIMEZONE_PROPS = ["source_tz", "report_tz"];

// The rule params with a sentence of their own ("Use Exif tag: {{rule}}"); any other shows as "name: value".
const RULE_PARAM_KEYS: Partial<Record<string, ParseKeys>> = {
  exif_tag: "rules.exif_tag",
  file_property: "rules.file_property",
  source_tz: "rules.source_tz",
  report_tz: "rules.report_tz",
  predefined_regexp: "rules.predefined_regexp",
  date_pattern: "rules.date_pattern",
  condition_path: "rules.condition_path",
  condition_filename: "rules.condition_filename",
  condition_exif: "rules.condition_exif",
};

/** A condition as the text it looks for: the form saves it escaped (dateRuleForm.escapePattern). */
function describeCondition(key: string, value: RuleValue, t: TFunction<"translation", undefined>): RuleValue {
  if (typeof value !== "string") return value;
  if (key !== "condition_exif") return unescapePattern(value);
  const [tag = "", text = ""] = value.split(/\/\/(.*)/s);
  return t("daterules.condition_exif_value", { tag, text: unescapePattern(text) });
}

function describeParam(key: string, value: unknown, t: TFunction<"translation", undefined>): RuleValue {
  const shown = ruleValue(value);
  if (TIMEZONE_PROPS.includes(key)) return describeTimezone(shown, t);
  return key.startsWith("condition_") ? describeCondition(key, shown, t) : shown;
}

export function getRuleExtraInfo(rule: DateTimeRule, t: TFunction<"translation", undefined>) {
  const ignoredProps = ["name", "id", "rule_type", "transform_tz", "is_default", "custom"];
  return (
    <>
      {Object.entries(rule)
        .filter(i => !ignoredProps.includes(i[0]))
        .map(([key, value]): [string, RuleValue] => [key, describeParam(key, value, t)])
        .map(([name, value]) => {
          const key = RULE_PARAM_KEYS[name];
          return (
            <div key={name}>
              {key ? (
                t(key, { rule: value })
              ) : (
                <>
                  {name}: {value}
                </>
              )}
            </div>
          );
        })}
    </>
  );
}
