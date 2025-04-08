import { AppShell, useComputedColorScheme, useMantineTheme } from "@mantine/core";
import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { TopMenuPublic } from "../components/menubars/TopMenuPublic";
import { selectIsAuthenticated } from "../store/auth/authSelectors";
import { useAppSelector } from "../store/store";
import { TOP_MENU_HEIGHT } from "../ui-constants";

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
