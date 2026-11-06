import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { Avatar } from "@mantine/core";
import { IconMapPin, IconTag } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useFetchPeopleAlbumsQuery,
  useFetchPlacesAlbumsQuery,
  useFetchThingsAlbumsQuery,
} from "../../api_client/albums/hooks";
import { displayLabel, matchesTerm } from "./exploreLists";
import { faceSource } from "./PeopleFilter";
import classes from "./SearchMatchChips.module.css";

/** At most this many of each kind: a row of chips, not a second result list. */
const PER_KIND = 4;

/**
 * Over the results of a search by words: the people, places and things whose names match them
 * ("beach" → the Beach thing), each a chip that opens its page, as Apple Photos and Google Photos
 * suggest them. Read from the lists the search box already loads (cached), so it asks nothing new.
 * Nothing when nothing matches.
 */
export function SearchMatchChips({ term }: Readonly<{ term: string }>) {
  const { t } = useTranslation();
  const { data: people } = useFetchPeopleAlbumsQuery();
  const { data: places } = useFetchPlacesAlbumsQuery();
  const { data: things } = useFetchThingsAlbumsQuery();
  const matches = useMemo(
    () => ({
      people: (people ?? [])
        .filter(person => person.name !== UNKNOWN_PERSON_NAME && matchesTerm(person.name, term))
        .slice(0, PER_KIND),
      places: (places ?? []).filter(place => matchesTerm(place.title, term)).slice(0, PER_KIND),
      things: (things ?? []).filter(thing => matchesTerm(thing.title, term)).slice(0, PER_KIND),
    }),
    [people, places, things, term]
  );
  if (matches.people.length + matches.places.length + matches.things.length === 0) return null;

  return (
    <div className={classes.row} role="group" aria-label={t("search.matches")}>
      {matches.people.map(person => (
        <Link key={`person:${person.id}`} to="/album/persons/$id" params={{ id: person.id }} className={classes.chip}>
          <Avatar src={faceSource(person)} alt="" size={24} radius="xl">
            {person.name.charAt(0).toLocaleUpperCase()}
          </Avatar>
          {person.name}
        </Link>
      ))}
      {matches.places.map(place => (
        <Link
          key={`place:${place.id}`}
          to="/album/places/$id"
          params={{ id: String(place.id) }}
          className={classes.chip}
          data-icon
        >
          <IconMapPin size={16} aria-hidden className={classes.icon} />
          {place.title}
        </Link>
      ))}
      {matches.things.map(thing => (
        <Link
          key={`thing:${thing.id}`}
          to="/album/things/$id"
          params={{ id: String(thing.id) }}
          className={classes.chip}
          data-icon
        >
          <IconTag size={16} aria-hidden className={classes.icon} />
          {displayLabel(thing.title)}
        </Link>
      ))}
    </div>
  );
}
