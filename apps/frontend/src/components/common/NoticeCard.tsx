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
  contentIndent?: number;
}>;

export function NoticeContent({
  tone,
  icon,
  title,
  badge,
  description,
  actions,
  children,
  contentIndent = 0,
}: NoticeContentProps) {
  return (
    <Stack gap="sm">
      <Group align={description ? "flex-start" : "center"} wrap="nowrap" gap="sm">
        <ThemeIcon variant="light" color={tone} size="lg" radius="md" aria-hidden>
          {icon}
        </ThemeIcon>
        <Stack gap={2} flex={1} miw={0}>
          <Group gap="xs" align="center">
            <Title order={3} size="h4">
              {title}
            </Title>
            {badge}
            <SectionLink />
          </Group>
          {description ? (
            <Text size="sm" c="dimmed">
              {description}
            </Text>
          ) : null}
        </Stack>
        {actions}
      </Group>
      {children ? (
        <Stack gap="sm" pl={{ base: 0, sm: contentIndent }}>
          {children}
        </Stack>
      ) : null}
    </Stack>
  );
}

export function NoticeCard({ contentIndent = 46, ...props }: NoticeContentProps) {
  return (
    <SettingsCard>
      <NoticeContent contentIndent={contentIndent} {...props} />
    </SettingsCard>
  );
}
