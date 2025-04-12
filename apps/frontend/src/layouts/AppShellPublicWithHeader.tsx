import { AppShell, useComputedColorScheme, useMantineTheme } from "@mantine/core";
import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { TopMenuPublic } from "../components/menubars/TopMenuPublic";
import { useAuth } from "../hooks/useAuth";
import { TOP_MENU_HEIGHT } from "../ui-constants";

export function AppShellPublicWithHeader() {
  const colorScheme = useComputedColorScheme();
  const theme = useMantineTheme();
  const { isAuthenticated } = useAuth();
  const { pathname } = useLocation();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  
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
