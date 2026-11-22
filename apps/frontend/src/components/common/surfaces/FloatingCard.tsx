import { createPolymorphicComponent, Paper } from "@mantine/core";
import React from "react";
import type { SurfaceProps } from "./Panel";

function FloatingCardRoot(props: SurfaceProps) {
  return <Paper withBorder radius="lg" shadow="xl" {...props} />;
}

export const FloatingCard = createPolymorphicComponent<"div", SurfaceProps>(FloatingCardRoot);
