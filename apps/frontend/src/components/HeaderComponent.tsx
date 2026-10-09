import { Box, Group, Loader, Stack, Text, Title } from "@mantine/core";
import React from "react";

type Props = {
  icon: React.ReactNode;
  title: string;
  fetching: boolean;
  subtitle: string;
};

export function HeaderComponent(props: Readonly<Props>) {
  const { icon, title, fetching, subtitle } = props;

  // The subtitle under the title, beside the icon, like MemoriesHeader and the albums overview
  return (
    <Group gap="sm" wrap="nowrap" mb={10} p={10}>
      {/* Keeps its size next to a long title instead of shrinking to a sliver */}
      <Box style={{ display: "flex", flexShrink: 0 }}>{icon}</Box>
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Title order={2}>
          {title} {fetching ? <Loader size={20} /> : null}
        </Title>
        <Text c="dimmed" size="sm">
          {subtitle}
        </Text>
      </Stack>
    </Group>
  );
}
