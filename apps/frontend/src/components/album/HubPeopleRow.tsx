import { Skeleton, Text } from "@mantine/core";
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
}>;

/** The hub row's card width: the People page's 3:4 portrait, smaller. */
const CARD_WIDTH = 120;
/** The row's people; "View all" opens the People page with the rest. */
const MAX_PEOPLE = 16;

/**
 * The album hub's People: the People page's 3:4 portrait cards (PersonCard), smaller and in one
 * scrolling row, so a person looks the same on both. Managing faces lives on the People page's ⋯.
 */
export function HubPeopleRow({ people, isLoading, error }: Props) {
  const { t } = useTranslation();
  const count = people?.length ?? 0;
  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div className={classes.scrollContainer}>
        {Array.from({ length: 8 }, (_, i) => (
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
  } else {
    body = (
      <div className={classes.scrollContainer}>
        {people.slice(0, MAX_PEOPLE).map(person => (
          <div key={person.id} className={classes.personCard}>
            <PersonCard person={person} size={CARD_WIDTH} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={classes.section}>
      <AlbumSectionHeading
        title={t("sidemenu.people")}
        summary={isLoading ? undefined : t("explore.peopleCount", { count })}
        viewAllLink="/album/persons"
      />
      {body}
    </div>
  );
}
