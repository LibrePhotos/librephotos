import type { CSSVariablesResolver } from "@mantine/core";
import { v8CssVariablesResolver } from "@mantine/core";
import { LIGHT_DIMMED, LIGHT_TEXT } from "./palette";

/**
 * Mantine 8's variables (transparent light variants), with the dark scheme's primary tint
 * corrected: Mantine derives it from the shade two steps lighter than the primary, which with the
 * pale dark-scheme primary is nearly white at 15 %, so active rows and tinted buttons read grey.
 * Here it is the primary itself at 18 % with a light primary text. The light scheme's dimmed text
 * is darker than Mantine's, to pass AA on the page background.
 */
export const appCssVariablesResolver: CSSVariablesResolver = theme => {
  const base = v8CssVariablesResolver(theme);
  const primary = theme.primaryColor;
  // Every colour's light variant (tinted chips, badges, light buttons) gets the same fix in the dark
  // scheme, so a green or orange status chip does not read grey.
  const darkTints = Object.fromEntries(
    Object.keys(theme.colors)
      .filter(color => color !== "dark" && color !== "gray")
      .flatMap(color => [
        [`--mantine-color-${color}-light`, `color-mix(in srgb, var(--mantine-color-${color}-filled) 18%, transparent)`],
        [
          `--mantine-color-${color}-light-hover`,
          `color-mix(in srgb, var(--mantine-color-${color}-filled) 24%, transparent)`,
        ],
        [`--mantine-color-${color}-light-color`, `var(--mantine-color-${color}-2)`],
        [`--mantine-color-${color}-text`, `var(--mantine-color-${color}-2)`],
      ])
  );
  return {
    ...base,
    light: {
      ...base.light,
      "--mantine-color-dimmed": LIGHT_DIMMED,
      // Text and headings in a soft near-black; --mantine-color-black stays black for scrims and
      // the viewer's stage.
      "--mantine-color-text": LIGHT_TEXT,
      "--mantine-primary-color-contrast": "var(--mantine-color-white)",
    },
    dark: {
      ...base.dark,
      ...darkTints,
      "--mantine-primary-color-light": `color-mix(in srgb, var(--mantine-color-${primary}-filled) 18%, transparent)`,
      "--mantine-primary-color-light-hover": `color-mix(in srgb, var(--mantine-color-${primary}-filled) 24%, transparent)`,
      "--mantine-primary-color-light-color": `var(--mantine-color-${primary}-2)`,
      "--mantine-color-anchor": `var(--mantine-color-${primary}-2)`,
      "--mantine-primary-color-contrast": `var(--mantine-color-${primary}-9)`,
    },
  };
};
