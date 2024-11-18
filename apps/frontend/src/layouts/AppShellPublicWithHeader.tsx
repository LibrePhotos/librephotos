import { AppShell, useMantineTheme } from "@mantine/core";
import React from "react";
import { Outlet } from "react-router-dom";

import { TopMenuPublic } from "../components/menubars/TopMenuPublic";
import { TOP_MENU_HEIGHT } from "../ui-constants";

export function AppShellPublicWithHeader() {
  const theme = useMantineTheme();
  return (
    <AppShell header={{ height: TOP_MENU_HEIGHT }}>
      <AppShell.Header>
        <TopMenuPublic />;
      </AppShell.Header>
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
