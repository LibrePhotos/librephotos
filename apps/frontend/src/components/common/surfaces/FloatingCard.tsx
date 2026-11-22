import { createPolymorphicComponent, Paper } from "@mantine/core";
import cx from "clsx";
import React from "react";
import classes from "./FloatingCard.module.css";
import type { SurfaceProps } from "./Panel";

function FloatingCardRoot({ className, ...props }: SurfaceProps) {
  return <Paper withBorder radius="lg" shadow="xl" className={cx(classes.root, className)} {...props} />;
}

export const FloatingCard = createPolymorphicComponent<"div", SurfaceProps>(FloatingCardRoot);
