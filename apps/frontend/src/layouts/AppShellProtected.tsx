import { AppShell } from "@mantine/core";
import React from "react";

import { SideMenuNarrow } from "../components/menubars/SideMenuNarrow";
import { TopMenu } from "../components/menubars/TopMenu";
import { LEFT_MENU_WIDTH, TOP_MENU_HEIGHT } from "../ui-constants";

export function AppShellProtected({ children }: { children: React.ReactNode }) {
  return (
    <AppShell header={{ height: TOP_MENU_HEIGHT }} navbar={{ width: LEFT_MENU_WIDTH, breakpoint: "sm" }}>
      <AppShell.Header>
        <TopMenu />;
      </AppShell.Header>
      <AppShell.Navbar>
        <SideMenuNarrow />
      </AppShell.Navbar>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
