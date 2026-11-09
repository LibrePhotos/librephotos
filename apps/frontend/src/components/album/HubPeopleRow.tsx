import { Skeleton, Text } from "@mantine/core";
import { useElementSize, useMediaQuery } from "@mantine/hooks";
import React from "react";
import { useTranslation } from "react-i18next";
import type { Person } from "../../api_client/albums/hooks";
import { ErrorState } from "../common/ErrorState";
import type { ListFailure } from "../common/useListFailure";
import { AlbumSectionHeading } from "./AlbumSection";
import classes from "./AlbumSection.module.css";
import { PersonCard } from "./PersonCard";

type Props = Readonly<{
  people: readonly Person[] | undefined;
  isLoading: boolean;
  error?: ListFailure;
  /** How many people there are in all, when `people` is a pick of them (Explore's most photographed). */
  total?: number;
}>;

/** The hub row's narrowest card and gap (AlbumSection.module.css .peopleGrid): the People page's 3:4 portrait, smaller. */
const CARD_MIN = { desktop: 120, phone: 96 };
const GAP = { desktop: 16, phone: 12 };

/** A phone's sideways strip: this many people, at this card width (a bit over three on screen). */
const PHONE_STRIP = { max: 15, card: 104 };

/** How many cards of at least `min` px fit one row of `width` px, as `auto-fill` lays them out. */
function columnsFor(width: number, min: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

/**
 * The People row of the album hub and of Explore: the People page's 3:4 portrait cards
 * (PersonCard), smaller and in one row of as many as fit, so a person looks the same everywhere and
 * the row ends where the albums do. On a phone the row scrolls sideways instead. Faces are reviewed from the People page.
 */
export function HubPeopleRow({ people, isLoading, error, total }: Props) {
  const { t } = useTranslation();
  const { ref, width } = useElementSize();
  const isPhone = useMediaQuery("(max-width: 47.99em)", undefined, { getInitialValueInEffect: false }) === true;
  const min = isPhone ? CARD_MIN.phone : CARD_MIN.desktop;
  const gap = isPhone ? GAP.phone : GAP.desktop;
  // One row that ends on the grid's right edge; "View all" opens the People page with the rest
  const columns = width > 0 ? columnsFor(width, min, gap) : 0;
  const count = total ?? people?.length ?? 0;
  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div className={classes.peopleGrid}>
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className={classes.personSkeleton} radius={12} />
        ))}
      </div>
    );
  } else if (error) {
    body = <ErrorState failure={error} compact />;
  } else if (!people || people.length === 0) {
    body = (
      <div className={classes.emptyState}>
        <Text c="dimmed">{t("emptystate.people.title")}</Text>
      </div>
    );
  } else if (isPhone) {
    // A phone swipes sideways through more of them, as Google Photos' People row does
    body = (
      <div className={classes.peopleStrip}>
        {people.slice(0, PHONE_STRIP.max).map(person => (
          <PersonCard key={person.id} person={person} size={PHONE_STRIP.card} />
        ))}
      </div>
    );
  } else {
    body = (
      <div className={classes.peopleGrid}>
        {people.slice(0, columns).map(person => (
          <PersonCard key={person.id} person={person} size={Math.round(width / Math.max(columns, 1))} />
        ))}
      </div>
    );
  }
  return (
    <div className={classes.section} ref={ref}>
      <AlbumSectionHeading
        title={t("sidemenu.people")}
        summary={isLoading ? undefined : t("explore.peopleCount", { count })}
        viewAllLink="/album/persons"
      />
      {body}
    </div>
  );
}
