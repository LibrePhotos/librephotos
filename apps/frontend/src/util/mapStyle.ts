import type { StyleSpecification } from "maplibre-gl";
import { useMemo } from "react";
import { useGetSettingsQuery } from "../api_client/settings/hooks";

// The historical, hardcoded default. Loads map tiles (and, for the Places page,
// glyphs/sprites) from PhotoPrism's public CDN.
export const PHOTOPRISM_STYLE_URL = "https://cdn.photoprism.app/maps/default.json";

// A self-contained raster style backed by the OpenStreetMap standard tile server.
// Glyphs are pulled from the OpenMapTiles public font server so that the Places
// page's cluster-count labels still render; every other map only uses HTML markers
// or circle layers and needs no glyphs.
export const OSM_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {
    "osm-raster": {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: "osm-raster", type: "raster", source: "osm-raster" }],
};

// A resolved map style is either something MapLibre can render (a style-JSON URL
// or a style object) or `null`, meaning the map display is turned off.
export type ResolvedMapStyle = string | StyleSpecification | null;

export function resolveMapStyle(provider: string | undefined): ResolvedMapStyle {
  switch (provider) {
    case "none":
      return null;
    case "osm":
      return OSM_STYLE;
    case "photoprism":
    default:
      // Undefined (settings still loading) also lands here, preserving the
      // historical default so maps don't flicker to a placeholder on first paint.
      return PHOTOPRISM_STYLE_URL;
  }
}

/**
 * Resolves the map style from site settings. `mapsDisabled` is true when the
 * admin has turned map display off ("None"); callers should render a placeholder
 * instead of a `<MapGL>` in that case.
 */
export function useMapStyle(): { mapStyle: ResolvedMapStyle; mapsDisabled: boolean } {
  const { data: settings } = useGetSettingsQuery();
  const provider = settings?.map_tile_provider;
  return useMemo(() => {
    const mapStyle = resolveMapStyle(provider);
    return { mapStyle, mapsDisabled: mapStyle === null };
  }, [provider]);
}
