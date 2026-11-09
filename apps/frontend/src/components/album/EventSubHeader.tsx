import type { AutoAlbum } from "@librephotos/api-client";
import { Avatar } from "@mantine/core";
import { IconMap2 } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/urls";
import { META_CHIP_AVATAR, META_CHIP_ICON, MetaChip } from "../common/MetaChip";
import { CollectionMeta } from "./CollectionMeta";

type Props = Readonly<{
  people: AutoAlbum["people"];
  /** Whether any photo of the event has a position, so the map has something to show. */
  hasGPSCoordinates: boolean;
  showMap: boolean;
  onToggleMap: () => void;
  /** The places of the event's photos (`eventLocationNames`); the first names the map button. */
  locationNames: string[];
}>;

/**
 * An event's meta line before its photo count: the days it spans and up to three places its title
 * does not name ("Oct 17 – 18, 2026 · Sintra"). Empty parts drop out.
 */
export function eventMetaLine(daySpan: string | null, locationNames: readonly string[], title: string): string {
  const places = locationNames.filter(name => !title.includes(name)).slice(0, 3);
  return [daySpan, places.join(", ")].filter(Boolean).join(" · ");
}

const MAX_PEOPLE = 5;

/** The event's people as chips (face and name, linked to their page), then "+N" for the rest, named on hover. */
function EventPeople({ people }: Readonly<{ people: AutoAlbum["people"] }>) {
  const rest = people.slice(MAX_PEOPLE);
  return (
    <>
      {people.slice(0, MAX_PEOPLE).map(person => (
        <MetaChip
          key={person.id}
          leading={<Avatar radius="xl" src={serverAddress + person.face_url} alt="" size={META_CHIP_AVATAR} />}
          // A router link, not an <a href> that reloaded the app
          renderRoot={props => <Link to="/album/persons/$id" params={{ id: String(person.id) }} {...props} />}
        >
          {person.name}
        </MetaChip>
      ))}
      {rest.length > 0 ? (
        <MetaChip title={rest.map(person => person.name).join(", ")}>{`+${rest.length}`}</MetaChip>
      ) : null}
    </>
  );
}

/**
 * Under an event's title and meta line (`eventMetaLine`), like the album pages: its people and the
 * map, one chip style for both. Nothing for an event with neither.
 */
export function EventSubHeader({ people, hasGPSCoordinates, showMap, onToggleMap, locationNames }: Props) {
  const { t } = useTranslation();

  let mapLabel = t("autoalbumgallery.showmap");
  if (showMap) mapLabel = t("autoalbumgallery.hidemap");
  else if (locationNames[0]) mapLabel = t("autoalbumgallery.showonmap", { place: locationNames[0] });

  const hasRow = people.length > 0 || hasGPSCoordinates;

  return (
    <CollectionMeta parts={[]}>
      {hasRow ? (
        <>
          {people.length > 0 && <EventPeople people={people} />}
          {hasGPSCoordinates && (
            // Tinted while the map is open
            <MetaChip
              leading={<IconMap2 size={META_CHIP_ICON} aria-hidden />}
              active={showMap}
              onClick={() => {
                // The map opens above the (sticky) header: bring it into view
                if (!showMap) window.scrollTo({ top: 0, behavior: "smooth" });
                onToggleMap();
              }}
            >
              {mapLabel}
            </MetaChip>
          )}
        </>
      ) : null}
    </CollectionMeta>
  );
}
