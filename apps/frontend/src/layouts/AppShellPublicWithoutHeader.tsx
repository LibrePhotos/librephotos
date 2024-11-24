import { AppShell, useMantineColorScheme, useMantineTheme } from "@mantine/core";
import React from "react";
import { Outlet } from "react-router-dom";

export function AppShellPublicWithoutHeader() {
  const theme = useMantineTheme();
  const { colorScheme } = useMantineColorScheme();
  return (
    <AppShell>
      <AppShell.Main
        style={{
          backgroundColor: colorScheme === "dark" ? theme.colors.dark[8] : theme.colors.gray[0],
        }}
      >
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
