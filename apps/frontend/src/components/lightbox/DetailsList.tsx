import { Text } from "@mantine/core";
import React from "react";
import classes from "./DetailsList.module.css";
import type { DetailRow } from "./photoDetails";

/** The labelled "Show more" values of the camera, the same in the Details panel and on the photo page. */
export function DetailsList({ rows }: Readonly<{ rows: DetailRow[] }>) {
  if (rows.length === 0) return null;
  return (
    <dl className={classes.list}>
      {rows.map(row => (
        <React.Fragment key={row.key}>
          <Text component="dt" size="xs" c="dimmed">
            {row.label}
          </Text>
          <Text component="dd" size="xs" className={classes.value}>
            {row.value}
          </Text>
        </React.Fragment>
      ))}
    </dl>
  );
}
