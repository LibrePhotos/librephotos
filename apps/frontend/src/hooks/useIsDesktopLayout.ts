import { useMantineTheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

/**
 * True where the AppShell shows its desktop navbar and hides the phone footer: from the theme's
 * sm breakpoint up. Components that must agree with the shell read this instead of a pixel width,
 * because the breakpoint is in em and moves with the browser's font size.
 */
export function useIsDesktopLayout(): boolean {
  const theme = useMantineTheme();
  return useMediaQuery(`(min-width: ${theme.breakpoints.sm})`, undefined, { getInitialValueInEffect: false });
}
