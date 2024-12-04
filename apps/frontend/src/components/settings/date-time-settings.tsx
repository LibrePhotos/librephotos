import type { TFunction } from "i18next";
import React from "react";

import type { DateTimeRule } from "./date-time.zod";

export function getRuleExtraInfo(rule: DateTimeRule, t: TFunction<"translation", undefined>) {
  const ignoredProps = ["name", "id", "rule_type", "transform_tz", "is_default"];
  return (
    <>
      {Object.entries(rule)
        .filter(i => !ignoredProps.includes(i[0]))
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
