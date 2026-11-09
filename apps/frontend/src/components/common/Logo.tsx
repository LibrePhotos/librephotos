import { Image, useComputedColorScheme } from "@mantine/core";
import React from "react";

type Props = Readonly<{
  /** Width and height in px. */
  size: number;
}>;

/**
 * The LibrePhotos mark in its own colours: the dark logo on a light page, the white one on a dark
 * page. Decorative: the wordmark or heading next to it names the app.
 */
export function Logo({ size }: Props): React.JSX.Element {
  // Not useMantineColorScheme: its value is "auto" on a dark OS, which drew the dark logo on the
  // dark header.
  const colorScheme = useComputedColorScheme("light", { getInitialValueInEffect: false });
  return <Image src={colorScheme === "dark" ? "/logo-white.png" : "/logo.png"} alt="" w={size} h={size} />;
}
