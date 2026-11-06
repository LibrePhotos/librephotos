import { Group, Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import React from "react";
import { Logo } from "../common/Logo";
import classes from "./TopMenu.module.css";

export function TopMenuLogo(): React.ReactNode {
  // The accent-coloured mark and the wordmark, as Google Photos and Immich name themselves in the
  // header. The mark is decorative: the wordmark names the link.
  return (
    <Link to="/" className={classes.logoLink}>
      <Group gap={8} wrap="nowrap">
        <Logo size={26} />
        <Text component="span" className={classes.wordmark}>
          LibrePhotos
        </Text>
      </Group>
    </Link>
  );
}
