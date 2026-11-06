import { Skeleton } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Layer, Source } from "react-map-gl/maplibre";
import { useFetchLocationClustersQuery, useFetchPlacesAlbumsQuery } from "../../api_client/albums/hooks";
import { useMapStyle } from "../../util/mapStyle";
import { CollectionCard } from "../common/CollectionCard";
import { clusterFeatureCollection, initialViewForClusters } from "../map/locationClusters";
import { MapDisabledPlaceholder } from "../map/MapDisabledPlaceholder";
import { ignoreMissingStyleImages } from "../map/mapImages";
import { miniPointLayer } from "../map/placesLayers";
import { ThemedMap } from "../map/ThemedMap";
import { useMapLayerColors } from "../map/useMapLayerColors";
import classes from "./PlacesMapCard.module.css";

// The card is too small for the Places page's padding and zoom: a single place still shows
// its country, and with none it shows the whole world.
const FIT_CARD = { padding: 12, maxZoom: 4 };
const CARD_WORLD_VIEW = { longitude: 0, latitude: 30, zoom: 0.8 };

export function PlacesMapCard() {
  const { t } = useTranslation();
  // Null while map display is turned off
  const { mapStyle } = useMapStyle();
  const { data: albums, isLoading: isLoadingAlbums } = useFetchPlacesAlbumsQuery();
  const { data: locationClusters, isLoading: isLoadingClusters } = useFetchLocationClustersQuery();

  const isLoading = isLoadingAlbums || isLoadingClusters;
  const count = albums?.length ?? 0;

  // Convert locationClusters to GeoJSON
  const geojsonData = useMemo(() => clusterFeatureCollection(locationClusters), [locationClusters]);
  const initialViewState = useMemo(() => initialViewForClusters(geojsonData, FIT_CARD, CARD_WORLD_VIEW), [geojsonData]);
  const layerColors = useMapLayerColors();
  const pointLayer = useMemo(() => miniPointLayer(layerColors), [layerColors]);

  if (isLoading) {
    return <Skeleton className={classes.loading} radius={12} />;
  }

  return (
    <CollectionCard
      shape="wide"
      size={240}
      title={t("sidemenu.places")}
      meta={t("explore.placeCount", { count })}
      renderLink={props => <Link {...props} to="/album/places" />}
      media={
        <div className={classes.mapContainer}>
          {mapStyle === null ? (
            <MapDisabledPlaceholder height="100%" />
          ) : (
            <ThemedMap
              ref={ignoreMissingStyleImages}
              h="100%"
              initialViewState={initialViewState}
              mapStyle={mapStyle}
              interactive={false}
              renderWorldCopies={false}
              attributionControl={false}
            >
              <Source id="locations" type="geojson" data={geojsonData}>
                <Layer {...pointLayer} />
              </Source>
            </ThemedMap>
          )}
        </div>
      }
    />
  );
}
