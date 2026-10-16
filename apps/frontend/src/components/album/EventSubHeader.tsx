import type { AutoAlbum } from "@librephotos/api-client";
import { Avatar, Button, Divider, Group, Tooltip } from "@mantine/core";
import { IconMap2 } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/urls";

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
 * Under an event's title, like the folder and album pages: its people and the map button. The
 * page leaves it out for an event with neither.
 */
export function EventSubHeader({ people, hasGPSCoordinates, showMap, onToggleMap, locationNames }: Props) {
  const { t } = useTranslation();

  let mapLabel = t("autoalbumgallery.showmap");
  if (showMap) mapLabel = t("autoalbumgallery.hidemap");
  else if (locationNames[0]) mapLabel = t("autoalbumgallery.showonmap", { place: locationNames[0] });

  return (
    <Group align="center" wrap="nowrap" gap="sm" mt="xs">
      {people.length > 0 && (
        <Avatar.Group>
          {people.slice(0, 5).map(person => (
            <Tooltip key={person.id} label={person.name} withArrow>
              <Avatar
                // A router link, not an <a href> that reloaded the app
                renderRoot={props => <Link to="/album/persons/$id" params={{ id: String(person.id) }} {...props} />}
                radius="xl"
                src={serverAddress + person.face_url}
                alt={person.name}
                size="sm"
              />
            </Tooltip>
          ))}
        </Avatar.Group>
      )}

      {hasGPSCoordinates && (
        <>
          {people.length > 0 && <Divider orientation="vertical" />}
          <Button
            variant={showMap ? "filled" : "light"}
            color={showMap ? "blue" : "gray"}
            onClick={() => {
              // The map opens above the (sticky) header: bring it into view
              if (!showMap) window.scrollTo({ top: 0, behavior: "smooth" });
              onToggleMap();
            }}
            leftSection={<IconMap2 size={16} />}
            size="xs"
          >
            {mapLabel}
          </Button>
        </>
      )}
    </Group>
  );
}
