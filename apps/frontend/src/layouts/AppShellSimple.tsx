import { AppShell } from "@mantine/core";
import React from "react";

export function AppShellSimple({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
