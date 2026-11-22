import { Card, CardSection, createPolymorphicComponent } from "@mantine/core";
import React from "react";
import type { SurfaceCardProps } from "./ContentCard";

function MediaCardRoot(props: SurfaceCardProps) {
  return <Card withBorder radius="md" {...props} />;
}

export const MediaCard = Object.assign(createPolymorphicComponent<"div", SurfaceCardProps>(MediaCardRoot), {
  Section: CardSection,
});
