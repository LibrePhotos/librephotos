import {
  ActionIcon,
  Box,
  Button,
  Combobox,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Tooltip,
  useCombobox,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconCurrentLocation, IconSearch } from "@tabler/icons-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import MapGL, {
  AttributionControl,
  MapLayerMouseEvent,
  MapRef,
  Marker,
  MarkerDragEvent,
  NavigationControl,
} from "react-map-gl/maplibre";
import { useGeocodeSearchQuery } from "../../api_client/geocode";
import { useUpdatePhotoMutation } from "../../api_client/photos/hooks/useUpdatePhotoMutation";

const MAP_STYLE = "https://cdn.photoprism.app/maps/default.json";

type Props = Readonly<{
  imageHash: string;
  onClose: () => void;
  initialLat?: number;
  initialLon?: number;
}>;

export function LocationPickerModal({ imageHash, onClose, initialLat, initialLon }: Props) {
  const { t } = useTranslation();
  const mapRef = useRef<MapRef>(null);

  const [position, setPosition] = useState<[number, number] | null>(
    initialLat !== undefined && initialLon !== undefined ? [initialLat, initialLon] : null
  );
  const [searchValue, setSearchValue] = useState("");
  const [debouncedSearch] = useDebouncedValue(searchValue, 300);
  const [isGeolocating, setIsGeolocating] = useState(false);
  const [geolocationError, setGeolocationError] = useState<string | null>(null);

  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });

  const { data: searchResults, isLoading: isSearching } = useGeocodeSearchQuery(debouncedSearch);

  const initialCenter = useMemo<[number, number]>(() => position ?? [48.8566, 2.3522], []);
  const initialZoom = position ? 13 : 3;

  const { mutateAsync, isPending } = useUpdatePhotoMutation();

  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    const { lat, lng } = e.lngLat;
    setPosition([lat, lng]);
  }, []);

  const handleMarkerDragEnd = useCallback((e: MarkerDragEvent) => {
    const { lat, lng } = e.lngLat;
    setPosition([lat, lng]);
  }, []);

  const handleSave = useCallback(async () => {
    if (!position) return;
    const [lat, lon] = position;
    await mutateAsync({ id: imageHash, data: { exif_gps_lat: lat, exif_gps_lon: lon } as any });
    onClose();
  }, [mutateAsync, position, imageHash, onClose]);

  const handleSelectLocation = useCallback(
    (lat: number, lon: number) => {
      setPosition([lat, lon]);
      setSearchValue("");
      combobox.closeDropdown();
      // Pan map to the selected location
      mapRef.current?.flyTo({ center: [lon, lat], zoom: 13 });
    },
    [combobox]
  );

  const handleUseMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeolocationError(
        t("locationpicker.geolocation_not_supported", "Geolocation is not supported by your browser")
      );
      return;
    }

    setIsGeolocating(true);
    setGeolocationError(null);

    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        setPosition([latitude, longitude]);
        setIsGeolocating(false);
        // Pan map to the user's location
        mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 13 });
      },
      error => {
        setIsGeolocating(false);
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setGeolocationError(t("locationpicker.permission_denied", "Location permission denied"));
            break;
          case error.POSITION_UNAVAILABLE:
            setGeolocationError(t("locationpicker.position_unavailable", "Location unavailable"));
            break;
          case error.TIMEOUT:
            setGeolocationError(t("locationpicker.timeout", "Location request timed out"));
            break;
          default:
            setGeolocationError(t("locationpicker.unknown_error", "An unknown error occurred"));
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [t]);

  // Try to get user's location on mount if no initial position
  useEffect(() => {
    if (!position && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const { latitude, longitude } = pos.coords;
          mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 5 });
        },
        () => {
          // Silently fail - we'll use the default center
        },
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }
      );
    }
  }, []);

  const searchOptions = searchResults?.map(result => (
    <Combobox.Option value={`${result.lat},${result.lon}`} key={`${result.lat}-${result.lon}`}>
      <Text size="sm" lineClamp={2}>
        {result.display_name}
      </Text>
    </Combobox.Option>
  ));

  return (
    <Stack>
      <Group gap="xs" align="flex-start">
        <Combobox
          store={combobox}
          onOptionSubmit={val => {
            const [lat, lon] = val.split(",").map(Number);
            handleSelectLocation(lat, lon);
          }}
        >
          <Combobox.Target>
            <TextInput
              placeholder={t("locationpicker.search_placeholder", "Search for a location...")}
              value={searchValue}
              onChange={e => {
                setSearchValue(e.currentTarget.value);
                combobox.openDropdown();
              }}
              onFocus={() => {
                if (searchValue.length > 2) {
                  combobox.openDropdown();
                }
              }}
              onBlur={() => combobox.closeDropdown()}
              leftSection={<IconSearch size={16} />}
              rightSection={isSearching ? <Loader size={16} /> : null}
              style={{ flex: 1 }}
            />
          </Combobox.Target>

          <Combobox.Dropdown>
            <Combobox.Options>
              {searchOptions && searchOptions.length > 0 ? (
                searchOptions
              ) : (
                <Combobox.Empty>
                  {debouncedSearch.length > 2
                    ? t("locationpicker.no_results", "No locations found")
                    : t("locationpicker.type_to_search", "Type at least 3 characters to search")}
                </Combobox.Empty>
              )}
            </Combobox.Options>
          </Combobox.Dropdown>
        </Combobox>

        <Tooltip label={t("locationpicker.use_my_location", "Use my current location")}>
          <ActionIcon
            variant="light"
            size="lg"
            onClick={handleUseMyLocation}
            loading={isGeolocating}
            aria-label={t("locationpicker.use_my_location", "Use my current location")}
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
        {t("locationpicker.instructions", "Click on the map to set the location, or search above.")}
      </Text>

      <Box style={{ height: 350 }}>
        <MapGL
          ref={mapRef}
          initialViewState={{
            longitude: initialCenter[1],
            latitude: initialCenter[0],
            zoom: initialZoom,
          }}
          style={{ width: "100%", height: 350 }}
          mapStyle={MAP_STYLE}
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
        </MapGL>
      </Box>

      {position && (
        <Text size="xs" c="dimmed">
          {t("locationpicker.coordinates", "Coordinates")}: {position[0].toFixed(6)}, {position[1].toFixed(6)}
        </Text>
      )}

      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t("locationpicker.cancel", "Cancel")}
        </Button>
        <Button onClick={handleSave} disabled={!position} loading={isPending}>
          {t("locationpicker.save", "Save")}
        </Button>
      </Group>
    </Stack>
  );
}
