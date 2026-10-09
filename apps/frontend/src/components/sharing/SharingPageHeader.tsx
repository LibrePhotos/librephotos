import { Group, Stack, Text, Title } from "@mantine/core";
import type { TablerIcon } from "@tabler/icons-react";
import React from "react";
import type { ReactNode } from "react";

type Props = Readonly<{
  icon: TablerIcon;
  /** The colour of this page's section on the sharing overview, if it has one. */
  color?: string;
  title: ReactNode;
  subtitle?: ReactNode;
}>;

/**
 * The header of every sharing page: same icon size and title/subtitle stack as
 * the album pages. The icon stays beside a long subtitle on a phone instead of
 * wrapping onto a line of its own.
 */
export function SharingPageHeader({ icon: PageIcon, color, title, subtitle }: Props) {
  return (
    <Group gap="sm" wrap="nowrap" align="center" mb="md">
      <PageIcon size={50} stroke={1.5} color={color} style={{ flexShrink: 0 }} />
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Title order={2}>{title}</Title>
        {subtitle && (
          <Text c="dimmed" size="sm">
            {subtitle}
          </Text>
        )}
      </Stack>
    </Group>
  );
}
