import type { ReactNode } from "react";
import React from "react";
import classes from "./CollectionMeta.module.css";

type Props = Readonly<{
  /** The dimmed meta line's parts, joined by " · ": the days it spans, its place. Empty ones drop out. */
  parts: ReadonlyArray<string | null | undefined | false>;
  /** After the meta line's text, on the same line: a small action ("Add birth date"). */
  trailing?: ReactNode;
  /** Its own row under the line: its chips (`MetaChip`), the people in it. */
  children?: ReactNode;
}>;

/**
 * A collection page's identity under its title and photo count (PhotoListView's
 * `additionalSubHeader`): when its photos were taken and where, then who and what is in it. Only
 * real data: a part the collection has no value for is left out, and with nothing left so is the
 * line.
 */
export function CollectionMeta({ parts, trailing, children }: Props) {
  const text = parts.filter((part): part is string => typeof part === "string" && part !== "").join(" · ");
  if (!text && !trailing && !children) return null;
  return (
    <div className={classes.root}>
      {text || trailing ? (
        <div className={classes.line}>
          {text ? <span>{text}</span> : null}
          {text && trailing ? <span aria-hidden>·</span> : null}
          {trailing}
        </div>
      ) : null}
      {children ? <div className={classes.row}>{children}</div> : null}
    </div>
  );
}
