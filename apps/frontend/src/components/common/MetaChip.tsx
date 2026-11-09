import { UnstyledButton } from "@mantine/core";
import type { ReactNode } from "react";
import React from "react";
import classes from "./MetaChip.module.css";

/** The leading avatar's and icon's sizes in a MetaChip. */
export const META_CHIP_AVATAR = 20;
export const META_CHIP_ICON = 16;

type Props = Readonly<{
  /** A 20px avatar (`META_CHIP_AVATAR`) or a 16px icon (`META_CHIP_ICON`) before the text. */
  leading?: ReactNode;
  children: ReactNode;
  /** A toggle that is on (the open map): accent tint and `aria-pressed`. */
  active?: boolean;
  onClick?: () => void;
  /** Renders the chip as a link (a router `Link`), like Mantine's `renderRoot`. */
  renderRoot?: (props: Record<string, unknown>) => ReactNode;
  title?: string;
}>;

/**
 * One chip for every collection header (review r6 #10): a person, a place, the map, the people an
 * album is shared with. 28px tall, fully round, a 1px hairline and 13px/500 text. With `onClick`
 * it is a button, with `renderRoot` a link, with neither a plain label.
 */
export function MetaChip({ leading, children, active, onClick, renderRoot, title }: Props) {
  const content = (
    <>
      {leading}
      <span className={classes.label}>{children}</span>
    </>
  );
  if (!onClick && !renderRoot) {
    return (
      <span className={classes.chip} data-bare={!leading || undefined} title={title}>
        {content}
      </span>
    );
  }
  return (
    <UnstyledButton
      className={classes.chip}
      data-interactive
      data-bare={!leading || undefined}
      data-active={active || undefined}
      aria-pressed={onClick && active !== undefined ? active : undefined}
      onClick={onClick}
      renderRoot={renderRoot}
      title={title}
    >
      {content}
    </UnstyledButton>
  );
}
