import { useMemo } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/Icon";
import { useTheme } from "@/theme";

/**
 * A static map preview, built from OpenStreetMap raster tiles fetched as plain
 * images.
 *
 * Why not a real map component: every native map module (react-native-maps,
 * expo-maps) is either absent from Expo Go or needs a config plugin and a dev
 * build, and an iOS dev build needs a paid Apple account this project has
 * declined (README "Dependency constraints"). Adding one would make the app
 * unopenable on the maintainer's phone — a strictly worse outcome than a
 * non-interactive map.
 *
 * The tile URL is the same `tile.openstreetmap.org` template the web frontend
 * already ships as its `osm` map style, and `expo-image`'s disk cache makes a
 * previously-seen location work offline (doc 07 §1.3, tier B). Tapping hands off
 * to the platform maps app, which is where a phone user wants to pan and zoom
 * anyway.
 */

const TILE_SIZE = 256;
/** OSM's raster tiles stop here; asking beyond it returns 404s. */
const MAX_ZOOM = 19;
export const DEFAULT_ZOOM = 14;

export type TilePlacement = { x: number; y: number; z: number; left: number; top: number };
export type TileLayout = { tiles: TilePlacement[]; size: number };

export function lonToTileX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * 2 ** zoom;
}

export function latToTileY(lat: number, zoom: number): number {
  // Web Mercator is undefined at the poles; clamp to the tile grid's own limit.
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom;
}

/**
 * Which tiles cover a `width`×`height` viewport centred on a coordinate, and
 * where each one sits inside it. Pure, so the arithmetic that decides whether
 * the pin lands on the right pixel is unit-tested rather than squinted at.
 */
export function tileLayout(args: {
  lat: number;
  lon: number;
  zoom?: number;
  width: number;
  height: number;
}): TileLayout {
  const zoom = Math.max(0, Math.min(MAX_ZOOM, Math.round(args.zoom ?? DEFAULT_ZOOM)));
  const scale = 2 ** zoom;
  const centreX = lonToTileX(args.lon, zoom) * TILE_SIZE;
  const centreY = latToTileY(args.lat, zoom) * TILE_SIZE;
  const left = centreX - args.width / 2;
  const top = centreY - args.height / 2;

  const tiles: TilePlacement[] = [];
  const firstX = Math.floor(left / TILE_SIZE);
  const lastX = Math.floor((left + args.width) / TILE_SIZE);
  const firstY = Math.floor(top / TILE_SIZE);
  const lastY = Math.floor((top + args.height) / TILE_SIZE);

  for (let ty = firstY; ty <= lastY; ty += 1) {
    // Above the north pole / below the south pole there is no tile row at all.
    if (ty < 0 || ty >= scale) continue;
    for (let tx = firstX; tx <= lastX; tx += 1) {
      tiles.push({
        // Longitude wraps, so a viewport crossing the antimeridian reuses the
        // tiles from the other edge of the world rather than showing a gap.
        x: ((tx % scale) + scale) % scale,
        y: ty,
        z: zoom,
        left: tx * TILE_SIZE - left,
        top: ty * TILE_SIZE - top,
      });
    }
  }
  return { tiles, size: TILE_SIZE };
}

export function tileUrl(tile: TilePlacement): string {
  return `https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;
}

/** The platform's own maps app, with a labelled pin. */
export function mapsAppUrl(lat: number, lon: number, label?: string | null): string {
  const coords = `${lat},${lon}`;
  if (Platform.OS === "ios") {
    const query = label ? `&q=${encodeURIComponent(label)}` : "";
    return `http://maps.apple.com/?ll=${coords}${query}`;
  }
  return `geo:${coords}?q=${coords}${label ? `(${encodeURIComponent(label)})` : ""}`;
}

export function MapPreview({
  latitude,
  longitude,
  label,
  height = 160,
  width,
  disabled = false,
  testID,
}: {
  latitude: number;
  longitude: number;
  label?: string | null;
  height?: number;
  /** Viewport width in px; the sheet passes its measured content width. */
  width: number;
  /** The server has map display turned off (`map_tile_provider === "none"`). */
  disabled?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const layout = useMemo(
    () => tileLayout({ lat: latitude, lon: longitude, width, height }),
    [latitude, longitude, width, height]
  );

  if (disabled) {
    return (
      <View
        testID={testID ? `${testID}-disabled` : undefined}
        style={{
          height,
          borderRadius: 10,
          backgroundColor: theme.background,
          borderWidth: 1,
          borderColor: theme.border,
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <Icon name="places" size={20} color={theme.muted} />
        <Text style={{ color: theme.muted, fontSize: 12 }}>{t("viewer.mapsDisabled")}</Text>
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t("viewer.openInMaps")}
      onPress={() => {
        void Linking.openURL(mapsAppUrl(latitude, longitude, label));
      }}
      style={{
        height,
        borderRadius: 10,
        overflow: "hidden",
        backgroundColor: theme.background,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      {layout.tiles.map((tile) => (
        <Image
          key={`${tile.z}/${tile.x}/${tile.y}`}
          testID={`${testID ?? "map"}-tile-${tile.x}-${tile.y}`}
          source={{ uri: tileUrl(tile) }}
          style={{
            position: "absolute",
            left: tile.left,
            top: tile.top,
            width: layout.size,
            height: layout.size,
          }}
          contentFit="cover"
          cachePolicy="disk"
          transition={120}
        />
      ))}
      {/* The pin sits at the exact viewport centre by construction. */}
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="location" size={28} color={theme.brand} />
      </View>
    </Pressable>
  );
}
