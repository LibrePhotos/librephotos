import { Tabs } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./PageTabs.module.css";
import { TabCount } from "./TabCount";

type PageTab<V extends string> = Readonly<{
  value: V;
  label: ReactNode;
  /** Dimmed after the label ("Duplicates 12"): no parentheses, no badge. Left out while unknown. */
  count?: number | null;
}>;

type Props<V extends string> = Readonly<{
  value: V;
  onChange: (value: V) => void;
  tabs: ReadonlyArray<PageTab<V>>;
  /** The tabs' `Tabs.Panel`s, when the page shows them here rather than through routes. */
  children?: ReactNode;
  /** Unmount hidden panels (Mantine keeps them mounted under `<Activity mode="hidden">`). */
  keepMounted?: boolean;
}>;

/**
 * The one way to switch between views of a page (Statistics, Organizing, the sharing pages): an
 * underline tab row under the page header, the count of a view dimmed after its label. Filters and
 * modes within a view are `Segmented` instead.
 */
export function PageTabs<V extends string>({ value, onChange, tabs, children, keepMounted }: Props<V>) {
  return (
    <Tabs
      value={value}
      keepMounted={keepMounted}
      onChange={next => {
        const tab = tabs.find(candidate => candidate.value === next);
        if (tab) onChange(tab.value);
      }}
      classNames={{ list: classes.list, tab: classes.tab, tabLabel: classes.label }}
    >
      <Tabs.List>
        {tabs.map(tab => (
          <Tabs.Tab key={tab.value} value={tab.value}>
            {tab.label}
            {tab.count === undefined || tab.count === null ? null : <TabCount count={tab.count} />}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {children}
    </Tabs>
  );
}
