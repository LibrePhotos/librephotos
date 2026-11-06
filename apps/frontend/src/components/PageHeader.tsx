import { Box, Group, Loader, Text, Title } from "@mantine/core";
import clsx from "clsx";
import type { ReactNode } from "react";
import { PAGE_GUTTER_PX } from "../uiConstants";
import classes from "./PageHeader.module.css";

type Props = Readonly<{
  // ReactNode so the photo lists can put their view switcher menu here
  title: ReactNode;
  // The one dimmed meta line under the title ("198 photos · 48 days")
  subtitle?: ReactNode;
  // Right side of the header, in one order on every page: the view control (media type or sort),
  // Filter, Select, the page's one create action, then the ⋯ (HeaderActionsMenu). Centred on the
  // title and subtitle, on a phone too, where it stays on the title's row.
  actions?: ReactNode;
  // Spinner next to the title while the page's data is loading
  loading?: boolean;
  // 2 for a header nested under its page's own PageHeader (a photo list inside a tab), so the
  // page keeps one h1. It looks the same either way.
  titleOrder?: 1 | 2;
  // Before the title and subtitle, centred on them: a person's face.
  leading?: ReactNode;
  // Under the title row, in the text's column: what the page adds to its header (an event's
  // description, the timeline filter's summary). The actions stay centred on the title row.
  below?: ReactNode;
}>;

/**
 * The header of every routed page: the one h1 on the page (an h2 when nested under another one,
 * `titleOrder`), a dimmed subtitle and the page's actions. No page icon: the title is the same
 * size on every page, so switching pages does not make the header jump, and its left edge is the
 * content's (PAGE_GUTTER).
 */
export function PageHeader({ title, subtitle, actions, loading = false, titleOrder = 1, leading, below }: Props) {
  return (
    <Box px={PAGE_GUTTER_PX} className={clsx(classes.root, leading ? classes.withLeading : undefined)} data-page-header>
      {leading ? <div className={classes.leading}>{leading}</div> : null}
      <div className={classes.text}>
        <Title order={titleOrder} size="h2" ta="left" className={classes.title}>
          {title}
          {loading ? <Loader size={18} className={classes.loader} /> : null}
        </Title>
        {subtitle ? (
          // A div, not Text: callers may put block content (the photo counts) in it
          <Text component="div" c="dimmed" size="sm" className={classes.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </div>
      {actions ? (
        <Group gap={4} wrap="nowrap" justify="flex-end" className={classes.actions}>
          {actions}
        </Group>
      ) : null}
      {below ? <div className={classes.below}>{below}</div> : null}
    </Box>
  );
}
