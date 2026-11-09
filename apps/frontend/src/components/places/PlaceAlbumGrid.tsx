import type { PlaceAlbumInfo } from "@librephotos/api-client";
import { IconMap2 as Map2 } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { CollectionCard } from "../common/CollectionCard";
import { TileGrid, type TileGridSizing } from "../virtual/TileGrid";

type Props = Readonly<{
  places: readonly PlaceAlbumInfo[];
  orderKey: string;
  sizing: TileGridSizing;
}>;

/**
 * The place albums under the Places map, laid out like the other album grids: square covers with
 * the title and photo count on them.
 */
export function PlaceAlbumGrid({ places, orderKey, sizing }: Props) {
  const { t } = useTranslation();
  return (
    <TileGrid
      scrollRestorationId="album-places"
      items={places}
      orderKey={orderKey}
      getKey={place => place.id}
      sizing={sizing}
      // A cover or a placeholder, so a place never depends on its cover to open (#2234)
      renderItem={(place, size) => (
        <CollectionCard
          size={size}
          title={place.title}
          meta={t("numberofphotos", { count: place.photo_count, number: place.photo_count })}
          covers={place.cover_photos.slice(0, 1)}
          placeholder={<Map2 />}
          renderLink={props => <Link {...props} to="/album/places/$id" params={{ id: String(place.id) }} />}
        />
      )}
    />
  );
}
