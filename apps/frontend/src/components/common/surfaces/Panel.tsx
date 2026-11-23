import { createPolymorphicComponent, Paper, type PaperProps } from "@mantine/core";
import React from "react";

export type SurfaceProps = Omit<PaperProps, "radius" | "shadow" | "withBorder">;

function PanelRoot(props: SurfaceProps) {
  return <Paper withBorder radius="md" {...props} />;
}

export const Panel = createPolymorphicComponent<"div", SurfaceProps>(PanelRoot);
