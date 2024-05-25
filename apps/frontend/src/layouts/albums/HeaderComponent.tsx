import { Group, Loader, Text, Title } from "@mantine/core";
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
    <Group justify="left">
      {icon}
      <div>
        <Title style={{ minWidth: 200 }} ta="left" order={2}>
          {title} {fetching ? <Loader size={20} /> : null}
        </Title>
        <Text ta="left" c="dimmed">
          {subtitle}
        </Text>
      </div>
    </Group>
  );
}
