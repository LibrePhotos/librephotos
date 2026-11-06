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
