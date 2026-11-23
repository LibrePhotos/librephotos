import { createPolymorphicComponent } from "@mantine/core";
import cx from "clsx";
import React from "react";
import { ContentCard, type SurfaceCardProps } from "../common/surfaces/ContentCard";
import classes from "./SettingsCard.module.css";

function SettingsCardRoot({ className, padding = "lg", ...props }: SurfaceCardProps) {
  return (
    <ContentCard
      padding={padding}
      className={cx(classes.card, className)}
      // A card that lays out its own padding (the server log's header bar) keeps it on a phone too.
      data-flush={padding === 0 || undefined}
      {...props}
    />
  );
}

/**
 * A card of a settings-type page (Settings, Profile, Library, Admin): a bordered, rounded card on a
 * wide screen; on a phone a grouped section edge to edge, as iOS and Android draw settings, with a
 * small uppercase title and a band between sections (SettingsCard.module.css). Polymorphic like
 * Mantine's Card, so a card can render as a form or a section.
 */
export const SettingsCard = createPolymorphicComponent<"div", SurfaceCardProps>(SettingsCardRoot);
