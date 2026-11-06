import { Title } from "@mantine/core";
import React from "react";
import classes from "./Sidebar.module.css";

/**
 * A section label of the info panel ("People", "Tags"): small, semi-bold and dimmed, so the photo
 * and the values stay what the eye goes to, as in Google Photos and Immich. Still a heading, for
 * screen readers' navigation.
 */
export function SectionTitle({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Title order={4} fz={13} fw={600} lh={1.4} c="dimmed">
      {children}
    </Title>
  );
}

/** A detail row's icon (date, file, camera, place): 20px and dimmed, level with the row's first line. */
export const ROW_ICON = { size: 20, color: "var(--mantine-color-dimmed)", className: classes.rowIcon } as const;
