import { Anchor, Image, Loader } from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import { IconMap2 as Map2 } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import _ from "lodash";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import MapGL, { AttributionControl, Source, Layer, MapRef, NavigationControl } from "react-map-gl/maplibre";
import type { CircleLayer, SymbolLayer, GeoJSONSource } from "maplibre-gl";
import { AutoSizer, Grid } from "react-virtualized";
import type { PlaceAlbumList } from "../../../api_client/albums/hooks";
import { useFetchLocationClustersQuery, useFetchPlacesAlbumsQuery } from "../../../api_client/albums/hooks";
import { serverAddress } from "../../../api_client/apiClient";
import { EmptyState } from "../../../components/common/EmptyState";
import { HeaderComponent } from "../../../components/HeaderComponent";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";

const MAP_STYLE = "https://cdn.photoprism.app/maps/default.json";

export const Route = createFileRoute("/_protected/album/places/")();

type Props = Readonly<{
  height?: number;
}>;

// Layer styles for clustered points
const clusterLayer: CircleLayer = {
  id: "clusters",
  type: "circle",
  source: "locations",
  filter: ["has", "point_count"],
  paint: {
    "circle-color": ["step", ["get", "point_count"], "#51bbd6", 10, "#f1f075", 50, "#f28cb1"],
    "circle-radius": ["step", ["get", "point_count"], 15, 10, 20, 50, 25],
  },
};

const clusterCountLayer: SymbolLayer = {
  id: "cluster-count",
  type: "symbol",
  source: "locations",
  filter: ["has", "point_count"],
  layout: {
    "text-field": "{point_count_abbreviated}",
    "text-font": ["Open Sans Bold"],
    "text-size": 12,
  },
  paint: {
    "text-color": "#000",
  },
};

const unclusteredPointLayer: CircleLayer = {
  id: "unclustered-point",
  type: "circle",
  source: "locations",
  filter: ["!", ["has", "point_count"]],
  paint: {
    "circle-color": "#11b4da",
    "circle-radius": 8,
    "circle-stroke-width": 2,
    "circle-stroke-color": "#fff",
  },
};

function AlbumPlace({ height }: Props) {
  const { width } = useViewportSize();
  const mapRef = useRef<MapRef>(null);
  const { t } = useTranslation();
  const [visibleAlbums, setVisibleAlbums] = useState<PlaceAlbumList>([]);
  const { data: albums, isFetching: isFetchingAlbums } = useFetchPlacesAlbumsQuery();
  const { data: locationClusters, isFetching: isFetchingLocationClusters } = useFetchLocationClustersQuery();
  const { entriesPerRow, entrySquareSize, numberOfRows, gridHeight } = useAlbumListGridConfig(albums || []);

  // Convert locationClusters to GeoJSON FeatureCollection
  const geojsonData = useMemo(() => {
    if (!locationClusters) {
      return { type: "FeatureCollection" as const, features: [] };
    }
    const features = locationClusters
      .filter((loc) => loc[0] !== 0)
      .map((loc, idx) => ({
        type: "Feature" as const,
        properties: {
          name: loc[2],
          id: idx,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [loc[0], loc[1]], // [lng, lat]
        },
      }));
    return { type: "FeatureCollection" as const, features };
  }, [locationClusters]);

  const updateVisibleAlbums = useCallback(
    (map: MapRef) => {
      if (!locationClusters || !albums) return;

      const bounds = map.getBounds();
      if (!bounds) return;

      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();

      const markers = locationClusters.filter((loc) => {
        const markerLng = loc[0];
        const markerLat = loc[1];
        return markerLat < ne.lat && markerLat > sw.lat && markerLng < ne.lng && markerLng > sw.lng;
      });

      const visiblePlaceNames = markers.map((el) => el[2]);
      const visiblePlaceAlbums = albums.filter((el) => visiblePlaceNames.includes(el.title));
      setVisibleAlbums(_.sortBy(visiblePlaceAlbums, ["geolocation_level", "photo_count"]));
    },
    [albums, locationClusters]
  );

  const onMoveEnd = useCallback(() => {
    if (!mapRef.current) return;
    updateVisibleAlbums(mapRef.current);
  }, [updateVisibleAlbums]);

  const onMapLoad = useCallback(() => {
    if (!mapRef.current) return;
    updateVisibleAlbums(mapRef.current);
  }, [updateVisibleAlbums]);

  // Handle click on clusters to zoom in
  const onClick = useCallback(async (event: any) => {
    if (!mapRef.current) return;

    const features = mapRef.current.queryRenderedFeatures(event.point, {
      layers: ["clusters"],
    });

    if (features.length > 0) {
      const clusterId = features[0].properties?.cluster_id;
      const mapboxSource = mapRef.current.getSource("locations") as GeoJSONSource;

      if (mapboxSource && clusterId !== undefined) {
        try {
          const zoom = await mapboxSource.getClusterExpansionZoom(clusterId);
          const coordinates = (features[0].geometry as any).coordinates;

          mapRef.current.easeTo({
            center: coordinates,
            zoom: zoom,
          });
        } catch (err) {
          console.error("Error getting cluster expansion zoom:", err);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!mapRef.current || !albums || !locationClusters) return;
    updateVisibleAlbums(mapRef.current);
  }, [width, height, albums, locationClusters, updateVisibleAlbums]);

  function renderCell({ columnIndex, key, rowIndex, style }: any) {
    if (!visibleAlbums || visibleAlbums.length === 0) {
      return null;
    }
    const index = rowIndex * entriesPerRow + columnIndex;
    if (index >= visibleAlbums.length) {
      return <div key={key} style={style} />;
    }
    const place = visibleAlbums[index];
    return (
      <div key={key} style={style}>
        <div style={{ padding: 5 }}>
          {place.cover_photos.slice(0, 1).map((photo) => (
            <Anchor key={index} href={`/album/places/${place.id}`} pathParams={{ id: place.id }}>
              <Image
                width={entrySquareSize - 10}
                height={entrySquareSize - 10}
                src={`${serverAddress}/media/thumbnails_big/${photo.image_hash}`}
              />
            </Anchor>
          ))}
        </div>
        <div style={{ paddingLeft: 15, paddingRight: 15, height: 50 }}>
          <b>{place.title}</b>
          <br />{" "}
          {t("numberofphotos", {
            number: place.photo_count,
          })}
        </div>
      </div>
    );
  }

  if (isFetchingAlbums || isFetchingLocationClusters) {
    return (
      <div style={{ height }}>
        <Loader>{t("placealbum.maploading")}</Loader>
      </div>
    );
  }

  const hasPlaces = albums && albums.length > 0;

  return (
    <div>
      <HeaderComponent
        icon={<Map2 size={50} />}
        title={t("places")}
        fetching={isFetchingLocationClusters || isFetchingAlbums}
        subtitle={t("placealbum.showingplaces", {
          number: visibleAlbums.length,
        })}
      />
      {!isFetchingAlbums && !hasPlaces ? (
        <EmptyState
          icon={<Map2 size={40} />}
          title={t("emptystate.places.title")}
          description={t("emptystate.places.description")}
          actionLabel={t("emptystate.goToLibrary")}
          actionLink="/library"
        />
      ) : (
        <>
          <div style={{ marginLeft: -5 }}>
            <MapGL
              ref={mapRef}
              initialViewState={{
                longitude: 0,
                latitude: 40,
                zoom: 2,
              }}
              style={{ width: "100%", height: 240 }}
              mapStyle={MAP_STYLE}
              onMoveEnd={onMoveEnd}
              onLoad={onMapLoad}
              onClick={onClick}
              interactiveLayerIds={["clusters"]}
              attributionControl={false}
            >
              <NavigationControl position="top-right" />
              <AttributionControl compact={true} />
              <Source
                id="locations"
                type="geojson"
                data={geojsonData}
                cluster={true}
                clusterMaxZoom={14}
                clusterRadius={50}
              >
                <Layer {...clusterLayer} />
                <Layer {...clusterCountLayer} />
                <Layer {...unclusteredPointLayer} />
              </Source>
            </MapGL>
          </div>
          <AutoSizer disableHeight style={{ outline: "none", padding: 0, margin: 0 }}>
            {({ width: gridWidth }) => (
              <Grid
                style={{ outline: "none" }}
                cellRenderer={(props) => renderCell(props)}
                columnWidth={entrySquareSize}
                columnCount={entriesPerRow}
                height={gridHeight}
                width={gridWidth}
                rowHeight={entrySquareSize + 60}
                rowCount={numberOfRows}
              />
            )}
          </AutoSizer>
        </>
      )}
    </div>
  );
}

AlbumPlace.defaultProps = {
  height: 0,
};

Route.update({ component: AlbumPlace });
