import { AppShell } from "@mantine/core";
import React from "react";
import { Outlet } from "react-router-dom";

import { TopMenuPublic } from "../components/menubars/TopMenuPublic";
import { TOP_MENU_HEIGHT } from "../ui-constants";

export function AppShellPublicWithHeader() {
  return (
    <AppShell header={{ height: TOP_MENU_HEIGHT }}>
      <AppShell.Header>
        <TopMenuPublic />;
      </AppShell.Header>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
