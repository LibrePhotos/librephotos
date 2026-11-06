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
 * The frame of a settings-type page (Settings, Profile, Library, Admin, Jobs, a job): the header
 * and the cards keep the page gutter like every other page, the column stops at a reading width,
 * and every one of them sits in the same centred frame, with or without SectionNav's list, so
 * the title and the cards' left edge do not move from one settings page to the next.
 */
export function SettingsPageFrame({ header, children, withSectionNav = false }: Props) {
  return (
    <Box className={classes.frame}>
      <Box className={withSectionNav ? undefined : classes.column}>
        {header}
        <PageBody gap="md" pb="xl">
          {children}
        </PageBody>
      </Box>
    </Box>
  );
}
