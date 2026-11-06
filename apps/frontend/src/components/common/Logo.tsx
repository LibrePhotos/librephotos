import { Box } from "@mantine/core";
import React from "react";
import classes from "./Logo.module.css";

type Props = Readonly<{
  /** Width and height in px. */
  size: number;
}>;

/**
 * The LibrePhotos mark in the app's accent: the logo's shape (public/logo.png) as a mask over the
 * primary colour, so it follows the theme's accent in both schemes. Decorative:
 * the wordmark or heading next to it names the app.
 */
export function Logo({ size }: Props): React.JSX.Element {
  return <Box component="span" aria-hidden w={size} h={size} className={classes.mark} />;
}
