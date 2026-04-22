import { AppShell, useComputedColorScheme, useMantineTheme } from "@mantine/core";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import React from "react";
import { TopMenuPublic } from "../../components/menubars/TopMenuPublic";
import { TOP_MENU_HEIGHT } from "../../ui-constants";

export const Route = createFileRoute("/public")();

export function AppShellPublicWithHeader() {
  const colorScheme = useComputedColorScheme();
  const theme = useMantineTheme();

  return (
    <AppShell header={{ height: TOP_MENU_HEIGHT }}>
      <AppShell.Header>
        <TopMenuPublic />
      </AppShell.Header>
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

Route.update({ component: AppShellPublicWithHeader });
