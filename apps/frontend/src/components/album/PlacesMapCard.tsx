import { Skeleton, Text } from "@mantine/core";
import { IconMap } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import MapGL, { Source, Layer } from "react-map-gl/maplibre";
import type { CircleLayer } from "maplibre-gl";

import { useFetchLocationClustersQuery, useFetchPlacesAlbumsQuery } from "../../api_client/albums/hooks";
import classes from "./PlacesMapCard.module.css";

const MAP_STYLE = "https://cdn.photoprism.app/maps/default.json";

// Simplified layer for the mini map
const pointLayer: CircleLayer = {
  id: "points",
  type: "circle",
  source: "locations",
  paint: {
    "circle-color": "#11b4da",
    "circle-radius": 4,
    "circle-stroke-width": 1,
    "circle-stroke-color": "#fff",
  },
};

export function PlacesMapCard() {
  const { t } = useTranslation();
  const { data: albums, isLoading: isLoadingAlbums } = useFetchPlacesAlbumsQuery();
  const { data: locationClusters, isLoading: isLoadingClusters } = useFetchLocationClustersQuery();

  const isLoading = isLoadingAlbums || isLoadingClusters;
  const count = albums?.length ?? 0;

  // Convert locationClusters to GeoJSON
  const geojsonData = useMemo(() => {
    if (!locationClusters) {
      return { type: "FeatureCollection" as const, features: [] };
    }
    const features = locationClusters
      .filter((loc) => loc[0] !== 0)
      .map((loc, idx) => ({
        type: "Feature" as const,
        properties: { name: loc[2], id: idx },
        geometry: {
          type: "Point" as const,
          coordinates: [loc[0], loc[1]],
        },
      }));
    return { type: "FeatureCollection" as const, features };
  }, [locationClusters]);

  if (isLoading) {
    return (
      <div className={classes.card}>
        <Skeleton height={120} />
        <div className={classes.body}>
          <Skeleton height={20} width="60%" />
          <Skeleton height={14} width="40%" mt={8} />
        </div>
      </div>
    );
  }

  return (
    <Link to="/album/places" className={classes.card}>
      <div className={classes.mapContainer}>
        <MapGL
          initialViewState={{
            longitude: 0,
            latitude: 30,
            zoom: 0.8,
          }}
          style={{ width: "100%", height: "100%" }}
          mapStyle={MAP_STYLE}
          interactive={false}
          attributionControl={false}
        >
          <Source id="locations" type="geojson" data={geojsonData}>
            <Layer {...pointLayer} />
          </Source>
        </MapGL>
      </div>
      <div className={classes.body}>
        <div className={classes.title}>
          <IconMap size={20} stroke={1.5} />
          <Text fw={600} size="sm">{t("sidemenu.places")}</Text>
        </div>
        <Text size="xs" c="dimmed" mt={4}>
          {t("explore.albumCount", { count })}
        </Text>
      </div>
    </Link>
  );
}






