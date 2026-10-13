import { Stack } from "@mantine/core";
import { IconHash } from "@tabler/icons-react";
import React, { use, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import classes from "./SectionNav.module.css";
import { SectionIdContext, SectionNavContext } from "./sectionNavigation";

/**
 * A card (or a group of cards) that SectionNav can jump to and link to. A Stack, so cards rendered
 * as a fragment keep the page's gap between them. Its data attribute is sectionNavigation's SECTION_ATTRIBUTE.
 */
export function SettingsSection({ id, children }: { id: string; children: ReactNode }) {
  return (
    <SectionIdContext.Provider value={id}>
      <Stack component="section" id={id} tabIndex={-1} className={classes.section} data-settings-section="">
        {children}
      </Stack>
    </SectionIdContext.Provider>
  );
}

/**
 * The "#" after a card title: copies a link to the card and jumps to it. Nothing outside a
 * SettingsSection on a page with SectionNav (the job list on /jobs, for one).
 */
export function SectionLink() {
  const { t } = useTranslation();
  const id = use(SectionIdContext);
  const nav = use(SectionNavContext);
  if (!id || !nav) {
    return null;
  }

  return (
    <a
      href={`#${id}`}
      className={classes.link}
      aria-label={t("sectionnav.copylink")}
      title={t("sectionnav.copylink")}
      onClick={event => {
        event.preventDefault();
        nav.copyLink(id);
      }}
    >
      <IconHash size={16} stroke={2} />
    </a>
  );
}
