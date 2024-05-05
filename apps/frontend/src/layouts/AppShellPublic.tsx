import { AppShell } from "@mantine/core";
import React from "react";

import { TopMenuPublic } from "../components/menubars/TopMenuPublic";
import { TOP_MENU_HEIGHT } from "../ui-constants";

export function AppShellPublic({ children }: { children: React.ReactNode }) {
  return (
    <AppShell header={{ height: TOP_MENU_HEIGHT }}>
      <AppShell.Header>
        <TopMenuPublic />;
      </AppShell.Header>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
