import { Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import React, { type ReactNode } from "react";
import { SettingsCard } from "../settings/SettingsCard";
import { SectionLink } from "../settings/SettingsSection";

type NoticeTone = "brand" | "orange";

type NoticeContentProps = Readonly<{
  tone: NoticeTone;
  icon: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}>;

export function NoticeContent({ tone, icon, title, badge, description, actions, children }: NoticeContentProps) {
  return (
    <Stack gap="sm">
      <Group align="flex-start" wrap="nowrap" gap="sm">
        <ThemeIcon variant="light" color={tone} size="lg" radius="md" aria-hidden>
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
  );
}

export function NoticeCard(props: NoticeContentProps) {
  return (
    <SettingsCard>
      <NoticeContent {...props} />
    </SettingsCard>
  );
}
