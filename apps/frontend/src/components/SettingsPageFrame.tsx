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
 * The frame of a settings-type page (Settings, Profile, Library, Admin, Jobs, a job). The header
 * spans the page like every other page's, so the title sits at the same place everywhere and its
 * actions on the right edge; only the cards below stop at a reading width, left-aligned on the
 * page gutter, with SectionNav's list beside them where there is one.
 */
export function SettingsPageFrame({ header, children, withSectionNav = false }: Props) {
  return (
    <>
      {header}
      <Box className={withSectionNav ? classes.wide : classes.narrow}>
        <PageBody gap="md" pb="xl">
          {children}
        </PageBody>
      </Box>
    </>
  );
}
