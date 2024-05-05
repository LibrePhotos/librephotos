import { AppShell } from "@mantine/core";
import React from "react";

import { SideMenuNarrow } from "../components/menubars/SideMenuNarrow";
import { TopMenuPublic } from "../components/menubars/TopMenuPublic";
import { LEFT_MENU_WIDTH, TOP_MENU_HEIGHT } from "../ui-constants";

export function AppShellProtected({ children }: { children: React.ReactNode }) {
  return (
    <AppShell header={{ height: TOP_MENU_HEIGHT }} navbar={{ width: LEFT_MENU_WIDTH, breakpoint: "sm" }}>
      <AppShell.Header>
        <TopMenuPublic />;
      </AppShell.Header>
      <AppShell.Navbar>
        <SideMenuNarrow />
      </AppShell.Navbar>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
