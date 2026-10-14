import { ActionIcon, Group, Stack, Text, Tooltip } from "@mantine/core";
import { IconCurrentLocation } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { AttributionControl, Marker, NavigationControl } from "react-map-gl/maplibre";
import { useMapStyle } from "../../util/mapStyle";
import { LocationSearchBox } from "./LocationSearchBox";
import { PickedPlace } from "./PickedPlace";
import { ThemedMap } from "./ThemedMap";
import { PLACE_ZOOM, type LocationPicker } from "./useLocationPicker";

// A photo without a location opens on the whole world: neither the browser's position nor a
// fixed city is likely where an old photo was taken (#2283).
const WORLD_VIEW = { latitude: 20, longitude: 0, zoom: 1 };

type Props = Readonly<{
  picker: LocationPicker;
  /** Where the map opens: the photo's own location, else the world. */
  initialPosition: readonly [number, number] | null;
}>;

/**
 * The part of the location picker that picks: the search box (a place or pasted coordinates),
 * "use my location", the map and the picked place's name. Shared by the single-photo and the
 * selection picker.
 */
export function LocationPickerBody({ picker, initialPosition }: Props) {
  const { t } = useTranslation();
  const { mapStyle, mapsDisabled } = useMapStyle();
  const { position } = picker;

  return (
    <Stack>
      <Group gap="xs" align="flex-start" wrap="nowrap">
        <LocationSearchBox onSelect={picker.pick} />
        <Tooltip label={t("locationpicker.use_my_location")}>
          <ActionIcon
            variant="light"
            size="lg"
            onClick={picker.useMyLocation}
            loading={picker.isGeolocating}
            aria-label={t("locationpicker.use_my_location")}
          >
            <IconCurrentLocation size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {picker.geolocationError && (
        <Text size="xs" c="red">
          {picker.geolocationError}
        </Text>
      )}

      <Text size="sm" c="dimmed">
        {mapsDisabled ? t("locationpicker.instructions_no_map") : t("locationpicker.instructions")}
      </Text>

      {mapStyle !== null && (
        <ThemedMap
          ref={picker.setMapRef}
          h={350}
          initialViewState={
            initialPosition
              ? { latitude: initialPosition[0], longitude: initialPosition[1], zoom: PLACE_ZOOM }
              : WORLD_VIEW
          }
          mapStyle={mapStyle}
          onClick={picker.onMapClick}
          attributionControl={false}
        >
          <NavigationControl position="top-right" />
          <AttributionControl compact={true} />
          {position && (
            <Marker
              longitude={position[1]}
              latitude={position[0]}
              anchor="bottom"
              draggable
              onDragEnd={picker.onMarkerDragEnd}
            />
          )}
        </ThemedMap>
      )}

      {position && <PickedPlace position={position} knownPlace={picker.knownPlace} />}
    </Stack>
  );
}
