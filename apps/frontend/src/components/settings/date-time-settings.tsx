import { createStyles } from "@mantine/core";
import React from "react";

import type { DateTimeRule } from "./date-time.zod";

export const useDateTimeSettingsStyles = createStyles(theme => ({
  table: {
    width: "100%",
  },

  rule_type: {
    fontSize: "0.9rem",
    color: theme.colorScheme === "dark" ? theme.colors.gray[6] : theme.colors.dark[3],
  },

  rule_extra_info: {
    fontSize: "0.8rem",
    color: theme.colorScheme === "dark" ? theme.colors.gray[4] : theme.colors.dark[6],
  },

  item: {
    backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[7] : theme.white,
    "&:hover": {
      backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[9] : theme.colors.gray[1],
    },
  },

  dragHandle: {
    ...theme.fn.focusStyles(),
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    // color: theme.colorScheme === "dark" ? theme.colors.dark[1] : theme.colors.gray[6],
  },
}));

export function getRuleExtraInfo(rule: DateTimeRule, t: (s: string, o: Object) => string) {
  const ignoredProps = ["name", "id", "rule_type", "transform_tz"];
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
