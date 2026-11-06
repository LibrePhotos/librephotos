import type { MantineColorsTuple } from "@mantine/core";

/**
 * The dark scheme's neutral scale. Mantine's default dark greys (#242424 body, #2e2e2e inputs) read
 * muddy next to photos; this one is near-black like Immich and Google Photos, with one step per
 * surface: 9 page (`--mantine-color-body` uses 7), 6 raised surfaces and inputs, 5 hover, 4 borders.
 * Index 0 is the main text colour, 2 the dimmed text.
 */
export const DARK_SCALE: MantineColorsTuple = [
  "#ececee",
  "#c4c4ca",
  "#9a9aa2",
  "#7c7c85",
  "#37373d",
  "#2a2a2f",
  "#1f1f23",
  "#121214",
  "#0d0d0f",
  "#08080a",
];

/**
 * The app's accent, used as the primary colour. Stock Mantine blue put white text on #228be6
 * (3.6:1) and, in the dark scheme, on #4dabf7 (2.5:1). Light buttons fill with 6 (#1a66d2, 5.4:1
 * with white); dark ones with 2, a pastel that takes dark text (12:1), as Immich's does.
 */
export const BRAND_SCALE: MantineColorsTuple = [
  "#eaf2fe",
  "#d4e4fd",
  "#a8c7fa",
  "#7cacf8",
  "#4c8df6",
  "#2b74ee",
  "#1a66d2",
  "#1557b5",
  "#114894",
  "#0b3670",
];

/** Secondary text in the light scheme: Mantine's gray 6 is 3.2:1 on the page, this is 5.5:1. */
export const LIGHT_DIMMED = "#5f6670";

/** Main text in the light scheme: a soft near-black like Apple's #1d1d1f, not pure black. */
export const LIGHT_TEXT = "#1b1b1f";
