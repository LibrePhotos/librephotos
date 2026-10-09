import { useComputedColorScheme, useMantineTheme } from "@mantine/core";
import { createRootRoute, Outlet } from "@tanstack/react-router";

// The router passes no context to its routes (see createRouter in App.tsx).
export const Route = createRootRoute({
  component: AppShellPublicWithoutHeader,
});

function AppShellPublicWithoutHeader() {
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();
  return (
    <div
      style={{
        backgroundColor: colorScheme === "dark" ? theme.colors.dark[8] : theme.colors.gray[0],
        // min-height: login/signup can be taller than a short screen, and a
        // fixed height left the page below it in the body colour.
        minHeight: "100dvh",
      }}
    >
      <Outlet />
    </div>
  );
}
