import { Group, Image, Text, useComputedColorScheme } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import React from "react";
import classes from "./TopMenu.module.css";

export function TopMenuLogo(): React.ReactNode {
  // Not useMantineColorScheme: its value is "auto" on a dark OS, which drew the
  // dark logo on the dark header.
  const colorScheme = useComputedColorScheme("light", { getInitialValueInEffect: false });
  const imageSrc = colorScheme === "dark" ? "/logo-white.png" : "/logo.png";

  // Logo and wordmark, as Google Photos and Immich name themselves in the header. The image is
  // decorative: the wordmark names the link.
  return (
    <Link to="/" className={classes.logoLink}>
      <Group gap={8} wrap="nowrap">
        <Image h={26} w={26} src={imageSrc} alt="" />
        <Text component="span" className={classes.wordmark}>
          LibrePhotos
        </Text>
      </Group>
    </Link>
  );
}
