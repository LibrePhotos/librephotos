import type { TFunction } from "i18next";
import React from "react";
import type { DateTimeRule } from "./date-time.zod";

/** "exif", "path", ... as words; an unknown type shows as it is. */
export function describeRuleType(ruleType: string, t: TFunction<"translation", undefined>) {
  return t(`rules.rule_type_names.${ruleType}`, ruleType);
}

type RuleValue = string | number | boolean | undefined;

/** A timezone description as the backend's _get_tz reads it: "utc", "name:<tz>" or a keyword. */
function describeTimezone(value: RuleValue, t: TFunction<"translation", undefined>): RuleValue {
  if (typeof value !== "string") return value;
  if (value.startsWith("name:")) return value.slice("name:".length);
  if (value.toLowerCase() === "utc") return "UTC";
  return t(`rules.tz_names.${value}`, value);
}

const TIMEZONE_PROPS = ["source_tz", "report_tz"];

export function getRuleExtraInfo(rule: DateTimeRule, t: TFunction<"translation", undefined>) {
  const ignoredProps = ["name", "id", "rule_type", "transform_tz", "is_default"];
  return (
    <>
      {Object.entries(rule)
        .filter(i => !ignoredProps.includes(i[0]))
        .map(([key, value]): [string, RuleValue] => [
          key,
          TIMEZONE_PROPS.includes(key) ? describeTimezone(value, t) : value,
        ])
        .map(prop => (
          <div key={prop[0]}>
            {t(`rules.${prop[0]}`, { rule: prop[1] }) !== `rules.${prop[0]}` ? (
              <>{t(`rules.${prop[0]}`, { rule: prop[1] })}</>
            ) : (
              <>
                {prop[0]}: {prop[1]}
              </>
            )}
          </div>
        ))}
    </>
  );
}
