import { Group, Loader, Stack, Text, Title } from "@mantine/core";
import React from "react";

type Props = {
  icon: any;
  title: string;
  fetching: boolean;
  subtitle: string;
};

export function HeaderComponent(props: Readonly<Props>) {
  const { icon, title, fetching, subtitle } = props;

  return (
    <Stack gap="xs" mb={10} p={10}>
      <Group>
        {icon}
        <Title order={2}>
          {title} {fetching ? <Loader size={20} /> : null}
        </Title>
      </Group>
      <Text c="dimmed" size="sm">
        {subtitle}
      </Text>
    </Stack>
  );
}
