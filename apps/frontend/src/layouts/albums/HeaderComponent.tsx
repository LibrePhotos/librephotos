import { Box, Group, Loader, Stack, Text, Title, useComputedColorScheme, useMantineTheme } from "@mantine/core";
import React from "react";

type Props = {
  icon: any;
  title: string;
  fetching: boolean;
  subtitle: string;
};

export function HeaderComponent(props: Readonly<Props>) {
  const { icon, title, fetching, subtitle } = props;
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();

  return (
    <Box
      style={{
        padding: 10,
        backgroundColor: colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[0],
        borderRadius: 10,
        marginBottom: 10,
      }}
    >
      <Group align="flex-start" style={{ width: "100%" }}>
        <Box style={{ flexGrow: 1 }}>
          <Stack gap="xs">
            <Group>
              {icon}
              <Title order={2} style={{ minWidth: 200 }}>
                {title} {fetching ? <Loader size={20} /> : null}
              </Title>
            </Group>
            <Text c="dimmed" size="sm">
              {subtitle}
            </Text>
          </Stack>
        </Box>
      </Group>
    </Box>
  );
}
