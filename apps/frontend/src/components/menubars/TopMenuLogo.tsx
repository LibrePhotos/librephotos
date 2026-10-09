import { Image, useComputedColorScheme } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import React from "react";

export function TopMenuLogo(): React.ReactNode {
  // Not useMantineColorScheme: its value is "auto" on a dark OS, which drew the
  // dark logo on the dark header.
  const colorScheme = useComputedColorScheme("light", { getInitialValueInEffect: false });
  const imageSrc = colorScheme === "dark" ? "/logo-white.png" : "/logo.png";

  return (
    <Link to="/">
      <Image h={30} w={30} src={imageSrc} alt="LibrePhotos" />
    </Link>
  );
}
