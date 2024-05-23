import { AppShell } from "@mantine/core";
import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { SideMenuNarrow } from "../components/menubars/SideMenuNarrow";
import { TopMenu } from "../components/menubars/TopMenu";
import { selectIsAuthenticated } from "../store/auth/authSelectors";
import { useAppSelector } from "../store/store";
import { LEFT_MENU_WIDTH, TOP_MENU_HEIGHT } from "../ui-constants";

export function AppShellProtected() {
  const isAuth = useAppSelector(selectIsAuthenticated);
  const { pathname } = useLocation();

  if (!isAuth) {
    return <Navigate to="login" state={{ from: pathname }} replace />;
  }

  return (
    <AppShell header={{ height: TOP_MENU_HEIGHT }} navbar={{ width: LEFT_MENU_WIDTH, breakpoint: "sm" }}>
      <AppShell.Header>
        <TopMenu />;
      </AppShell.Header>
      <AppShell.Navbar>
        <SideMenuNarrow />
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
