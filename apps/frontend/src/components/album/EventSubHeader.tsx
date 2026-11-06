import type { AutoAlbum } from "@librephotos/api-client";
import { Avatar, Button, Tooltip } from "@mantine/core";
import { IconMap2 } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/urls";
import { CollectionMeta, CollectionMetaSeparator } from "./CollectionMeta";

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

/**
 * Under an event's title and meta line (`eventMetaLine`), like the album pages: its people and the
 * map chip. Nothing for an event with neither.
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
          {people.length > 0 && (
            <Avatar.Group spacing="xs">
              {people.slice(0, 5).map(person => (
                <Tooltip key={person.id} label={person.name} withArrow>
                  <Avatar
                    // A router link, not an <a href> that reloaded the app
                    renderRoot={props => <Link to="/album/persons/$id" params={{ id: String(person.id) }} {...props} />}
                    radius="xl"
                    src={serverAddress + person.face_url}
                    alt={person.name}
                    size={28}
                  />
                </Tooltip>
              ))}
            </Avatar.Group>
          )}
          {hasGPSCoordinates && (
            <>
              {people.length > 0 && <CollectionMetaSeparator />}
              {/* Body text on a quiet surface with a hairline (default), tonal while the map is open */}
              <Button
                variant={showMap ? "light" : "default"}
                radius="xl"
                onClick={() => {
                  // The map opens above the (sticky) header: bring it into view
                  if (!showMap) window.scrollTo({ top: 0, behavior: "smooth" });
                  onToggleMap();
                }}
                leftSection={<IconMap2 size={16} />}
                size="compact-sm"
              >
                {mapLabel}
              </Button>
            </>
          )}
        </>
      ) : null}
    </CollectionMeta>
  );
}
