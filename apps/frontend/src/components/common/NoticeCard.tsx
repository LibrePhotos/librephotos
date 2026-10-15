import { Card, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import React, { type ReactNode } from "react";
import { SectionLink } from "../settings/SettingsSection";
import classes from "./NoticeCard.module.css";

/**
 * One colour per kind of notice, so they tell apart at a glance: blue for a release to install,
 * grape for what is new, orange for work an update left to do.
 */
type NoticeColor = "blue" | "grape" | "orange";

type NoticeCardProps = Readonly<{
  color: NoticeColor;
  /** A Tabler icon, drawn in a light square in the card's colour. */
  icon: ReactNode;
  title: ReactNode;
  /** Next to the title: a count, a version. */
  badge?: ReactNode;
  description?: ReactNode;
  /** At the right of the header: a close or menu button. */
  actions?: ReactNode;
  children?: ReactNode;
}>;

/**
 * A card that asks for attention at the top of a page, in the page flow (never a modal): a bar in
 * its colour on top, an icon, a title with an optional badge and one explaining sentence, then its
 * content. Inside a SettingsSection the title links to it like every other card's.
 */
export function NoticeCard({ color, icon, title, badge, description, actions, children }: NoticeCardProps) {
  return (
    <Card shadow="md" className={classes.card} data-color={color}>
      <Stack gap="sm">
        <Group align="flex-start" wrap="nowrap" gap="sm">
          <ThemeIcon variant="light" color={color} size="lg" radius="md" aria-hidden>
            {icon}
          </ThemeIcon>
          <Stack gap={2} flex={1} miw={0}>
            <Group gap="xs" align="center">
              <Title order={4}>
                {title}
                <SectionLink />
              </Title>
              {badge}
            </Group>
            {description ? (
              <Text size="sm" c="dimmed">
                {description}
              </Text>
            ) : null}
          </Stack>
          {actions}
        </Group>
        {children}
      </Stack>
    </Card>
  );
}
