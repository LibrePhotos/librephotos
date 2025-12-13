import { useComputedColorScheme, useMantineTheme } from "@mantine/core";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import { SpotlightProvider } from "../components/spotlight";

interface MyRouterContext {}

export const Route = createRootRouteWithContext<MyRouterContext>()();

export function AppShellPublicWithoutHeader() {
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();
  return (
    <div
      style={{
        backgroundColor: colorScheme === "dark" ? theme.colors.dark[8] : theme.colors.gray[0],
        height: "100vh",
      }}
    >
      <SpotlightProvider />
      <Outlet />
    </div>
  );
}

Route.update({ component: AppShellPublicWithoutHeader });
