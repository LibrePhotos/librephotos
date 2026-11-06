import type { CSSVariablesResolver } from "@mantine/core";
import { v8CssVariablesResolver } from "@mantine/core";

/**
 * Mantine 8's variables (transparent light variants), with the dark scheme's primary tint
 * corrected: Mantine derives it from the shade two steps lighter than the primary, which with the
 * pale dark-scheme primary is nearly white at 15 %, so active rows and tinted buttons read grey.
 * Here it is the primary itself at 18 % with a light primary text.
 */
export const appCssVariablesResolver: CSSVariablesResolver = theme => {
  const base = v8CssVariablesResolver(theme);
  const primary = theme.primaryColor;
  return {
    ...base,
    dark: {
      ...base.dark,
      "--mantine-primary-color-light": `color-mix(in srgb, var(--mantine-color-${primary}-filled) 18%, transparent)`,
      "--mantine-primary-color-light-hover": `color-mix(in srgb, var(--mantine-color-${primary}-filled) 24%, transparent)`,
      "--mantine-primary-color-light-color": `var(--mantine-color-${primary}-3)`,
    },
  };
};
