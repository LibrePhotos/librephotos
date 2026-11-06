import classes from "./TabCount.module.css";

/** A tab's or segment's count, dimmed 12px after its label: one count format on every page. */
export function TabCount({ count }: Readonly<{ count: number }>) {
  return <span className={classes.count}>{count.toLocaleString()}</span>;
}
