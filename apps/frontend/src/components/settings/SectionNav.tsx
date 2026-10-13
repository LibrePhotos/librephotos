import { Box, Button, Flex, NavLink, ScrollArea, Text } from "@mantine/core";
import React, { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TOP_MENU_HEIGHT } from "../../uiConstants";
import classes from "./SectionNav.module.css";
import { SectionNavContext, type NavSection } from "./sectionNavigation";
import { useActiveSection } from "./useActiveSection";
import { useSectionLinks } from "./useSectionLinks";

// A section counts as reached once its top passes this far below the viewport top: under the top
// bar and, on phones, under the chip row.
const SPY_OFFSET = TOP_MENU_HEIGHT + 72;

type SectionLinksProps = {
  sections: readonly NavSection[];
  active: string | undefined;
  onPick: (id: string) => void;
};

/** A plain left click jumps in place; a modified one (new tab, copy) keeps the browser's default. */
function pickHandler(id: string, onPick: (id: string) => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onPick(id);
  };
}

function SectionToc({ sections, active, onPick }: SectionLinksProps) {
  const { t } = useTranslation();
  return (
    <Box component="nav" aria-label={t("sectionnav.onthispage")} className={classes.aside} visibleFrom="lg">
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="xs" px="sm">
        {t("sectionnav.onthispage")}
      </Text>
      {sections.map(({ id, label }) => (
        <NavLink
          key={id}
          component="a"
          href={`#${id}`}
          label={label}
          active={id === active}
          aria-current={id === active ? "location" : undefined}
          variant="light"
          py={6}
          onClick={pickHandler(id, onPick)}
        />
      ))}
    </Box>
  );
}

function SectionChips({ sections, active, onPick }: SectionLinksProps) {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);

  // Keep the active chip in view while the page scrolls.
  useEffect(() => {
    const chip = active ? viewport.current?.querySelector<HTMLElement>(`[href="#${active}"]`) : null;
    const row = viewport.current;
    if (!chip || !row) {
      return;
    }
    const outOfView =
      chip.offsetLeft < row.scrollLeft || chip.offsetLeft + chip.offsetWidth > row.scrollLeft + row.clientWidth;
    if (outOfView) {
      row.scrollTo?.({ left: chip.offsetLeft - 16 });
    }
  }, [active]);

  return (
    <Box component="nav" aria-label={t("sectionnav.onthispage")} className={classes.chipBar} hiddenFrom="lg">
      <ScrollArea type="never" scrollbars="x" viewportRef={viewport} className={classes.chipScroll}>
        <Flex gap="xs" wrap="nowrap" w="max-content" pr="lg">
          {sections.map(({ id, label }) => (
            <Button
              key={id}
              component="a"
              href={`#${id}`}
              size="compact-sm"
              radius="xl"
              fw={500}
              variant={id === active ? "light" : "default"}
              aria-current={id === active ? "location" : undefined}
              onClick={pickHandler(id, onPick)}
            >
              {label}
            </Button>
          ))}
        </Flex>
      </ScrollArea>
    </Box>
  );
}

/**
 * Hash links to a page's cards (#2226): a sticky "On this page" list beside the cards from the lg
 * breakpoint up, a sticky chip row above them below it. The entry of the card in view is
 * highlighted, and a link with a hash scrolls to its card (useSectionLinks).
 */
export function SectionNav({ sections, children }: { sections: readonly NavSection[]; children: ReactNode }) {
  const actions = useSectionLinks();
  const active = useActiveSection(
    sections.map(section => section.id),
    SPY_OFFSET
  );

  return (
    <SectionNavContext.Provider value={actions}>
      <Flex gap="xl" align="flex-start">
        <div className={classes.main}>
          <SectionChips sections={sections} active={active} onPick={actions.goTo} />
          {children}
        </div>
        <SectionToc sections={sections} active={active} onPick={actions.goTo} />
      </Flex>
    </SectionNavContext.Provider>
  );
}
