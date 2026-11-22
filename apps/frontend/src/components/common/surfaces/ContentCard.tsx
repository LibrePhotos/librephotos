import { Card, createPolymorphicComponent, type CardProps } from "@mantine/core";
import React from "react";

export type SurfaceCardProps = Omit<CardProps, "radius" | "shadow" | "withBorder">;

function ContentCardRoot({ padding = "lg", ...props }: SurfaceCardProps) {
  return <Card withBorder radius="lg" padding={padding} {...props} />;
}

export const ContentCard = createPolymorphicComponent<"div", SurfaceCardProps>(ContentCardRoot);
