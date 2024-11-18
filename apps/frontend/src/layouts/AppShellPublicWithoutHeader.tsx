import { AppShell, useMantineTheme } from "@mantine/core";
import React from "react";
import { Outlet } from "react-router-dom";

export function AppShellPublicWithoutHeader() {
  const theme = useMantineTheme();
  return (
    <AppShell>
      <AppShell.Main
        style={{
          backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[8] : theme.colors.gray[0],
        }}
      >
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
