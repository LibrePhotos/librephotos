import { ActionIcon, Button, Group, Stack, Text, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconCurrentLocation, IconMapPinOff } from "@tabler/icons-react";
import type { ParseKeys } from "i18next";
import React, { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MapLayerMouseEvent, MapRef, MarkerDragEvent } from "react-map-gl/maplibre";
import { AttributionControl, Marker, NavigationControl } from "react-map-gl/maplibre";
import { invalidatePlaces } from "../../api_client/albums/invalidatePlaces";
import { useUpdatePhotoMutation } from "../../api_client/photos/hooks/useUpdatePhotoMutation";
import { useMapStyle } from "../../util/mapStyle";
import { LocationSearchBox } from "./LocationSearchBox";
import { ignoreMissingStyleImages } from "./mapImages";
import { PickedPlace } from "./PickedPlace";
import { RemoveLocationModal } from "./RemoveLocationModal";
import { ThemedMap } from "./ThemedMap";

// Why the browser could not tell where the user is, by GeolocationPositionError code:
// PERMISSION_DENIED, POSITION_UNAVAILABLE and TIMEOUT.
const GEOLOCATION_ERROR_KEYS: Partial<Record<number, ParseKeys>> = {
  1: "locationpicker.permission_denied",
  2: "locationpicker.position_unavailable",
  3: "locationpicker.timeout",
};

// A photo without a location opens on the whole world: neither the browser's position nor a
// fixed city is likely where an old photo was taken (#2283).
const WORLD_VIEW = { latitude: 20, longitude: 0, zoom: 1 };
const PLACE_ZOOM = 13;

type Props = Readonly<{
  imageHash: string;
  onClose: () => void;
  initialLat?: number;
  initialLon?: number;
  /** The place name the photo has for its location, shown until another spot is picked. */
  initialPlace?: string;
  /** The removal confirmation opened or closed: the dialog around the picker leaves Escape to it. */
  onNestedDialogChange?: (opened: boolean) => void;
}>;

export function LocationPickerModal({
  imageHash,
  onClose,
  initialLat,
  initialLon,
  initialPlace,
  onNestedDialogChange,
}: Props) {
  const { t } = useTranslation();
  const mapRef = useRef<MapRef | null>(null);
  const setMapRef = useCallback((map: MapRef | null) => {
    mapRef.current = map;
    ignoreMissingStyleImages(map);
  }, []);
  const { mapStyle, mapsDisabled } = useMapStyle();

  // Fixed at mount: the photo's own location, which only it can remove.
  const [initialPosition] = useState<[number, number] | null>(() =>
    initialLat !== undefined && initialLon !== undefined ? [initialLat, initialLon] : null
  );
  const [position, setPosition] = useState<[number, number] | null>(initialPosition);
  const [isGeolocating, setIsGeolocating] = useState(false);
  const [geolocationError, setGeolocationError] = useState<string | null>(null);
  const [removeOpened, removeDialog] = useDisclosure(false, {
    onOpen: () => onNestedDialogChange?.(true),
    onClose: () => onNestedDialogChange?.(false),
  });

  const { mutate, isPending } = useUpdatePhotoMutation();

  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    const { lat, lng } = e.lngLat;
    setPosition([lat, lng]);
  }, []);

  const handleMarkerDragEnd = useCallback((e: MarkerDragEvent) => {
    const { lat, lng } = e.lngLat;
    setPosition([lat, lng]);
  }, []);

  const handleSave = () => {
    if (!position) return;
    const [lat, lon] = position;
    mutate(
      { id: imageHash, data: { exif_gps_lat: lat, exif_gps_lon: lon } },
      {
        onSuccess: () => {
          invalidatePlaces();
          onClose();
        },
      }
    );
  };

  const handleRemoved = () => {
    removeDialog.close();
    onClose();
  };

  // Pan to a picked spot: the map's first view is the photo's location or the world.
  const pickAndShow = useCallback((lat: number, lon: number) => {
    setPosition([lat, lon]);
    mapRef.current?.flyTo({ center: [lon, lat], zoom: PLACE_ZOOM });
  }, []);

  // The only place that asks the browser for the user's position: never on open (#2283).
  const handleUseMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeolocationError(t("locationpicker.geolocation_not_supported"));
      return;
    }

    setIsGeolocating(true);
    setGeolocationError(null);

    navigator.geolocation.getCurrentPosition(
      pos => {
        setIsGeolocating(false);
        pickAndShow(pos.coords.latitude, pos.coords.longitude);
      },
      error => {
        setIsGeolocating(false);
        setGeolocationError(t(GEOLOCATION_ERROR_KEYS[error.code] ?? "locationpicker.unknown_error"));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [t, pickAndShow]);

  const atInitialPosition =
    position !== null &&
    initialPosition !== null &&
    position[0] === initialPosition[0] &&
    position[1] === initialPosition[1];

  return (
    <Stack>
      <Group gap="xs" align="flex-start" wrap="nowrap">
        <LocationSearchBox onSelect={pickAndShow} />
        <Tooltip label={t("locationpicker.use_my_location")}>
          <ActionIcon
            variant="light"
            size="lg"
            onClick={handleUseMyLocation}
            loading={isGeolocating}
            aria-label={t("locationpicker.use_my_location")}
          >
            <IconCurrentLocation size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {geolocationError && (
        <Text size="xs" c="red">
          {geolocationError}
        </Text>
      )}

      <Text size="sm" c="dimmed">
        {mapsDisabled ? t("locationpicker.instructions_no_map") : t("locationpicker.instructions")}
      </Text>

      {mapStyle !== null && (
        <ThemedMap
          ref={setMapRef}
          h={350}
          initialViewState={
            initialPosition
              ? { latitude: initialPosition[0], longitude: initialPosition[1], zoom: PLACE_ZOOM }
              : WORLD_VIEW
          }
          mapStyle={mapStyle}
          onClick={handleMapClick}
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
              onDragEnd={handleMarkerDragEnd}
            />
          )}
        </ThemedMap>
      )}

      {position && <PickedPlace position={position} knownPlace={atInitialPosition ? initialPlace : undefined} />}

      <Group justify="space-between" wrap="wrap-reverse" gap="xs">
        <div>
          {initialPosition && (
            <Button
              variant="subtle"
              color="red"
              px="xs"
              leftSection={<IconMapPinOff size={16} />}
              onClick={removeDialog.open}
              disabled={isPending}
            >
              {t("locationpicker.remove_location")}
            </Button>
          )}
        </div>
        <Group gap="xs" ml="auto">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!position} loading={isPending}>
            {t("save")}
          </Button>
        </Group>
      </Group>

      <RemoveLocationModal
        opened={removeOpened}
        onClose={removeDialog.close}
        imageHash={imageHash}
        onRemoved={handleRemoved}
      />
    </Stack>
  );
}
