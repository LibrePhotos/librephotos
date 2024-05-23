import { AppShell } from "@mantine/core";
import React from "react";
import { Outlet } from "react-router-dom";

export function AppShellPublicWithoutHeader() {
  return (
    <AppShell>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
