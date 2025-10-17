import { Image, useMantineColorScheme } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import React from "react";

export function TopMenuLogo(): React.ReactNode {
  const { colorScheme } = useMantineColorScheme();
  const imageSrc = colorScheme === "dark" ? "/logo-white.png" : "/logo.png";

  return (
    <Link to="/">
      <Image height={30} width={30} src={imageSrc} />
    </Link>
  );
}
