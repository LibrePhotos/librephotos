import { Box } from "@mantine/core";
import type { ReactNode } from "react";
import { PageBody } from "./PageBody";
import classes from "./SettingsPageFrame.module.css";

type Props = Readonly<{
  /** The page's PageHeader (and anything above it, such as a back link). */
  header: ReactNode;
  children: ReactNode;
  /** Room for SectionNav's "On this page" list beside the cards (Settings, Admin). */
  withSectionNav?: boolean;
}>;

/**
 * The frame of a settings-type page (Settings, Profile, Library, Admin, Jobs, a job): a reading-width
 * column, left-aligned on the page gutter so the title sits where every page's does, holding the
 * header too, so its actions end at the cards' right edge rather than across the window;
 * SectionNav's list sits beside the cards where there is one.
 */
export function SettingsPageFrame({ header, children, withSectionNav = false }: Props) {
  return (
    <Box className={withSectionNav ? classes.wide : classes.narrow}>
      {header}
      <PageBody gap="md" pb="xl">
        {children}
      </PageBody>
    </Box>
  );
}
