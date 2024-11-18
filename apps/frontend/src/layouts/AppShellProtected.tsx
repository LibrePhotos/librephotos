import { AppShell, useMantineTheme } from "@mantine/core";
import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { FooterMenu } from "../components/menubars/FooterMenu";
import { SideMenuNarrow } from "../components/menubars/SideMenuNarrow";
import { TopMenu } from "../components/menubars/TopMenu";
import { useSidebarToggle } from "../hooks/useSidebarToggle";
import { selectIsAuthenticated } from "../store/auth/authSelectors";
import { useAppSelector } from "../store/store";
import { FOOTER_HEIGHT, LEFT_MENU_WIDTH, MIN_VIEWPORT_WODTH, TOP_MENU_HEIGHT } from "../ui-constants";

export function AppShellProtected() {
  const theme = useMantineTheme();
  const isAuth = useAppSelector(selectIsAuthenticated);
  const { sidebarVisible, toggleSidebar } = useSidebarToggle(true);
  const { pathname } = useLocation();

  if (!isAuth) {
    return <Navigate to="login" state={{ from: pathname }} replace />;
  }

  return (
    <AppShell
      header={{ height: TOP_MENU_HEIGHT }}
      navbar={{ width: LEFT_MENU_WIDTH, breakpoint: "sm", collapsed: { mobile: true, desktop: !sidebarVisible } }}
      footer={{ height: { base: FOOTER_HEIGHT, sm: 0 } }}
      style={{ minWidth: MIN_VIEWPORT_WODTH }}
      transitionDuration={0}
    >
      <AppShell.Header>
        <TopMenu toggleSidebar={toggleSidebar} />;
      </AppShell.Header>
      <AppShell.Navbar>
        <SideMenuNarrow />
      </AppShell.Navbar>
      <AppShell.Main
        style={{
          backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[8] : theme.colors.gray[0],
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
