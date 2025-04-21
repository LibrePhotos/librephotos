import { createFileRoute } from '@tanstack/react-router'
import { AppShell, useComputedColorScheme, useMantineTheme } from "@mantine/core";
import React from "react";
import {  Outlet } from '@tanstack/react-router';

import { TopMenuPublic } from "../../components/menubars/TopMenuPublic";
import { TOP_MENU_HEIGHT } from "../../ui-constants";

export const Route = createFileRoute('/public')({
  component: AppShellPublicWithHeader,
})

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
