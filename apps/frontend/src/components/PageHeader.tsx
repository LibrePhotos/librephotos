import { Group, Loader, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";
import { PAGE_GUTTER_PX } from "../uiConstants";
import classes from "./PageHeader.module.css";

type Props = Readonly<{
  // ReactNode so the photo lists can put their view switcher menu here
  title: ReactNode;
  subtitle?: ReactNode;
  // Right side of the header. Wraps below the title on a phone.
  actions?: ReactNode;
  // Spinner next to the title while the page's data is loading
  loading?: boolean;
  // 2 for a header nested under its page's own PageHeader (a photo list inside a tab), so the
  // page keeps one h1. It looks the same either way.
  titleOrder?: 1 | 2;
  // Before the title and subtitle, centred on them: a person's face.
  leading?: ReactNode;
}>;

/**
 * The header of every routed page: the one h1 on the page (an h2 when nested under another one,
 * `titleOrder`), a dimmed subtitle and the page's actions. No page icon: the title is the same
 * size on every page, so switching pages does not make the header jump, and its left edge is the
 * content's (PAGE_GUTTER).
 */
export function PageHeader({ title, subtitle, actions, loading = false, titleOrder = 1, leading }: Props) {
  const text = (
    <Stack gap={0} className={classes.text}>
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
    </Stack>
  );
  return (
    <Group justify="space-between" align="center" gap="xs" px={PAGE_GUTTER_PX} className={classes.root}>
      {leading ? (
        <Group gap="md" wrap="nowrap" className={classes.text}>
          {leading}
          {text}
        </Group>
      ) : (
        text
      )}
      {actions ? (
        <Group gap={4} justify="flex-end" className={classes.actions}>
          {actions}
        </Group>
      ) : null}
    </Group>
  );
}
