import type { VariantColorsResolver } from "@mantine/core";
import { defaultVariantColorsResolver } from "@mantine/core";

/**
 * Mantine picks a filled button's text colour from the light scheme's primary shade, so in the
 * dark scheme the pastel accent got white text (1.7:1). A filled control in the primary colour
 * takes the scheme's own contrast colour instead (cssVariables.ts sets it per scheme).
 */
export const appVariantColorResolver: VariantColorsResolver = input => {
  const colors = defaultVariantColorsResolver(input);
  const isPrimary = input.color === undefined || input.color === input.theme.primaryColor;
  if (input.variant === "filled" && isPrimary) {
    return { ...colors, color: "var(--mantine-primary-color-contrast)" };
  }
  return colors;
};
