import { SegmentedControl } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./Segmented.module.css";
import { TabCount } from "./TabCount";

type Segment<V extends string> = Readonly<{
  value: V;
  label: ReactNode;
  /** Dimmed after the label, as PageTabs shows it. */
  count?: number | null;
}>;

type Props<V extends string> = Readonly<{
  value: V;
  onChange: (value: V) => void;
  segments: ReadonlyArray<Segment<V>>;
  /** Names the group for screen readers when nothing around it does. */
  "aria-label"?: string;
}>;

/**
 * The one capsule control for a filter or mode within a page (Memories' Tiles/Gallery): a grey
 * pill track with the current segment raised on it. Switching between views of a page is
 * `PageTabs`. A tab list that needs this look (the faces tabs, which keep tab semantics for their
 * hover cards) takes `segmentedTabsClassNames`.
 */
export function Segmented<V extends string>({ value, onChange, segments, "aria-label": ariaLabel }: Props<V>) {
  return (
    <SegmentedControl
      value={value}
      aria-label={ariaLabel}
      radius="xl"
      classNames={{ root: classes.root, indicator: classes.indicator, label: classes.label }}
      onChange={next => {
        const segment = segments.find(candidate => candidate.value === next);
        if (segment) onChange(segment.value);
      }}
      data={segments.map(segment => ({
        value: segment.value,
        label: (
          <span className={classes.labelText}>
            {segment.label}
            {segment.count === undefined || segment.count === null ? null : <TabCount count={segment.count} />}
          </span>
        ),
      }))}
    />
  );
}

/** Segmented's capsule look for a Mantine `Tabs` (variant "pills"): `classNames={segmentedTabsClassNames}`. */
export const segmentedTabsClassNames = { list: classes.tabsList, tab: classes.tabsTab };
