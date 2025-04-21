import { useMantineTheme } from '@mantine/core';
import { useComputedColorScheme } from '@mantine/core';
import { AppShell } from '@mantine/core';
import { createRootRouteWithContext } from '@tanstack/react-router';
import { Outlet } from '@tanstack/react-router';

interface MyRouterContext {
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
    component: AppShellPublicWithoutHeader,
})



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
        <Outlet />
    </div>
  );
}   
