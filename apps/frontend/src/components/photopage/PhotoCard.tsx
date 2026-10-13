import type { MantineColor } from "@mantine/core";
import { Badge, Group, Paper, ThemeIcon, Title } from "@mantine/core";
import type { TablerIcon } from "@tabler/icons-react";
import React, { useId } from "react";
import classes from "./PhotoCard.module.css";

type Props = Readonly<{
  icon: TablerIcon;
  color: MantineColor;
  title: React.ReactNode;
  /** A count after the title, e.g. how many people are in the photo. */
  count?: number;
  /** Shown at the right end of the heading row. */
  aside?: React.ReactNode;
  /**
   * The card's content. A function gets the heading to place itself: a
   * section that keeps its edit controls in its own heading row (caption,
   * tags, place, people) shows it there instead of its own title.
   */
  children: React.ReactNode | ((heading: React.ReactNode) => React.ReactNode);
}>;

/**
 * One card of the photo page's column: a section with a tinted icon and an
 * h2 (the page's h1 is the date), so a screen reader can jump between them.
 */
export function PhotoCard({ icon: Icon, color, title, count, aside, children }: Props) {
  const headingId = useId();
  const heading = (
    <Group gap="xs" wrap="nowrap" className={classes.heading}>
      <ThemeIcon variant="light" color={color} size="md" radius="md" aria-hidden>
        <Icon size={16} />
      </ThemeIcon>
      <Title order={2} className={classes.title} id={headingId}>
        {title}
      </Title>
      {count !== undefined && count > 0 && (
        <Badge variant="light" color="gray" size="sm" circle>
          {count}
        </Badge>
      )}
    </Group>
  );
  const placesHeading = typeof children === "function";
  return (
    <Paper component="section" withBorder radius="md" className={classes.card} aria-labelledby={headingId}>
      {!placesHeading && (
        <Group justify="space-between" wrap="nowrap" className={classes.headingRow}>
          {heading}
          {aside}
        </Group>
      )}
      {placesHeading ? children(heading) : children}
    </Paper>
  );
}
