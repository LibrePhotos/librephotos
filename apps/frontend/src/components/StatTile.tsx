import { Box, Group, Paper, Text, Tooltip, VisuallyHidden } from "@mantine/core";
import React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { i18nResolvedLanguage } from "../i18n";
import { formatCompactCount, formatCount } from "../util/formatCount";
import classes from "./StatTile.module.css";

/** The class that keeps a wrapper around a tile (a HoverCard target) at the tile's full height. */
export const statTileFillClass = classes.fill;

// Below the `sm` breakpoint large counts are abbreviated (25123 -> "25.1K" in en) and
// the exact value is shown in a tooltip on hover, tap or keyboard focus. From `sm` up
// there is room for the full number, so it is shown directly without a tooltip.
// Screen readers always get the exact value via the visually hidden text.
// Pass `withTooltip={false}` inside another popover target (e.g. a HoverCard) so the
// two do not open together.
export function StatCount({ value, withTooltip = true }: { value: number; withTooltip?: boolean }) {
  // Subscribe to language changes so the numbers are re-formatted for the new locale.
  useTranslation();
  const locale = i18nResolvedLanguage();
  const full = formatCount(value, locale);
  const compact = formatCompactCount(value, locale);

  if (compact === full) {
    return full;
  }

  const compactWithFullForScreenReaders = (
    <>
      <span aria-hidden="true">{compact}</span>
      <VisuallyHidden>{full}</VisuallyHidden>
    </>
  );

  return (
    <>
      <Box component="span" visibleFrom="sm">
        {full}
      </Box>
      <Box component="span" hiddenFrom="sm">
        {withTooltip ? (
          <Tooltip label={full} events={{ hover: true, focus: true, touch: true }}>
            <span tabIndex={0}>{compactWithFullForScreenReaders}</span>
          </Tooltip>
        ) : (
          compactWithFullForScreenReaders
        )}
      </Box>
    </>
  );
}

type Props = Readonly<{
  /** A 16px icon before the label. */
  icon: ReactNode;
  label: string;
  /** The number, usually a StatCount. */
  value: ReactNode;
  /** A dimmed second count after the number ("/ 48 days"). */
  detail?: ReactNode;
}>;

/**
 * One neutral stat tile, as on the Library page and above the Statistics charts: icon and a 12px
 * dimmed label, then the number at 24px/700, so a row of them reads as one band.
 */
export function StatTile({ icon, label, value, detail }: Props) {
  return (
    <Paper withBorder radius="lg" px="md" py="sm" h="100%" className={classes.tile}>
      <Group gap={6} wrap="nowrap" className={classes.label}>
        {icon}
        <span>{label}</span>
      </Group>
      <Group gap={6} align="baseline" wrap="nowrap">
        <Text span className={classes.value}>
          {value}
        </Text>
        {detail ? (
          <Text span size="xs" c="dimmed" truncate>
            {detail}
          </Text>
        ) : null}
      </Group>
    </Paper>
  );
}
