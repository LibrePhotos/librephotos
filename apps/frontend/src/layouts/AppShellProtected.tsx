import { AppShell, Loader, useComputedColorScheme, useMantineTheme } from "@mantine/core";
import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { FooterMenu } from "../components/menubars/FooterMenu";
import { SideMenuNarrow } from "../components/menubars/SideMenuNarrow";
import { TopMenu } from "../components/menubars/TopMenu";
import { FOOTER_HEIGHT, LEFT_MENU_WIDTH, MIN_VIEWPORT_WODTH, TOP_MENU_HEIGHT } from "../ui-constants";
import { useIsAuthenticatedQuery } from "../api_client/auth";

export function AppShellProtected() {
  const colorScheme = useComputedColorScheme();
  const theme = useMantineTheme();
  const { data: isAuthenticated, isLoading } = useIsAuthenticatedQuery();
  const { pathname } = useLocation();

  if (isLoading) {
    return <Loader />;
  }

  if (!isAuthenticated && !isLoading) {
    console.log("Redirecting to login");
    return <Navigate to="login" state={{ from: pathname }} replace />;
  }

  return (
    <AppShell
      header={{ height: TOP_MENU_HEIGHT }}
      navbar={{ width: LEFT_MENU_WIDTH, breakpoint: "sm", collapsed: { mobile: true, desktop: false } }}
      footer={{ height: { base: FOOTER_HEIGHT, sm: 0 } }}
      style={{ minWidth: MIN_VIEWPORT_WODTH }}
      transitionDuration={0}
    >
      <AppShell.Header>
        <TopMenu />
      </AppShell.Header>
      <AppShell.Navbar>
        <SideMenuNarrow />
      </AppShell.Navbar>
      <AppShell.Main
        style={{
          backgroundColor: colorScheme === "dark" ? theme.colors.dark[8] : theme.colors.gray[0],
        }}
      >
        <Outlet />
      </AppShell.Main>
      <AppShell.Footer>
        <FooterMenu />
      </AppShell.Footer>
    </AppShell>
  );
}
