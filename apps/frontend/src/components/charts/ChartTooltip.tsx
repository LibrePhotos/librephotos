import { Box, Popover } from "@mantine/core";
import React from "react";
import classes from "./StatisticsCharts.module.css";

/** The box a tooltip points at, in the plot's own coordinates (its top-left corner is 0, 0). */
type ChartAnchor = Readonly<{ x: number; y: number; width: number; height: number }>;

type Props = Readonly<{
  /** Which side of the anchor; Floating UI flips it where there is no room. */
  position?: "top" | "right";
  /** The bar shown; null hides the tooltip. */
  anchor: ChartAnchor | null;
  /** Re-places the tooltip when it changes: the bar's index. */
  anchorKey: string | number;
  children: React.ReactNode;
}>;

/**
 * A chart's tooltip: above (or beside) the bar it describes, flipped or shifted where the window has no room,
 * and portalled, so a card's edge never clips it. It repeats what the bar's accessible name says,
 * so assistive tech is not told twice and it never takes the pointer.
 */
export function ChartTooltip({ anchor, anchorKey, position = "top", children }: Props) {
  return (
    <Popover
      opened={anchor !== null}
      position={position}
      offset={position === "top" ? 8 : 12}
      withRoles={false}
      withinPortal
      shadow="md"
      // At once, as the bar under the pointer changes: no fade to wait for, nothing to reduce
      transitionProps={{ duration: 0 }}
    >
      <Popover.Target>
        {/* A new target per bar, so the popover measures the bar it now points at */}
        <Box
          key={anchorKey}
          pos="absolute"
          left={anchor?.x ?? 0}
          top={anchor?.y ?? 0}
          w={anchor?.width ?? 0}
          h={anchor?.height ?? 0}
          className={classes.tooltipAnchor}
          aria-hidden
        />
      </Popover.Target>
      <Popover.Dropdown className={classes.tooltipDropdown} aria-hidden>
        {children}
      </Popover.Dropdown>
    </Popover>
  );
}
