import { Box, Button, Group, Stack, Text } from "@mantine/core";
import React, { useCallback, useMemo, useState } from "react";
import { Map, Marker, TileLayer } from "react-leaflet";
import L from "leaflet";

import { useUpdatePhotoMutation } from "../../api_client/photos/hooks/useUpdatePhotoMutation";

type Props = Readonly<{
  imageHash: string;
  onClose: () => void;
  initialLat?: number;
  initialLon?: number;
}>;

export function LocationPickerModal({ imageHash, onClose, initialLat, initialLon }: Props) {
  const [position, setPosition] = useState<[number, number] | null>(
    initialLat !== undefined && initialLon !== undefined ? [initialLat, initialLon] : null
  );

  const center = useMemo<[number, number]>(
    () => position ?? [0, 0],
    [position]
  );

  const { mutateAsync, isPending } = useUpdatePhotoMutation();

  const handleClick = useCallback((e: L.LeafletMouseEvent) => {
    const {lat} = e.latlng;
    const lon = e.latlng.lng;
    setPosition([lat, lon]);
  }, []);

  const handleSave = useCallback(async () => {
    if (!position) return;
    const [lat, lon] = position;
    await mutateAsync({ id: imageHash, data: { exif_gps_lat: lat, exif_gps_lon: lon } as any });
    onClose();
  }, [mutateAsync, position, imageHash, onClose]);

  return (
    <Stack>
      <Text size="sm">Click on the map to set the location. Drag the marker to fine tune.</Text>
      <Box style={{ height: 350 }}>
        <Map center={center} zoom={13} style={{ height: 350 }} onclick={handleClick as any}>
          <TileLayer
            attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {position && (
            <Marker
              position={position}
              draggable
              ondragend={(e: any) => {
                const marker = e.target as L.Marker;
                const { lat, lng } = marker.getLatLng();
                setPosition([lat, lng]);
              }}
            />
          )}
        </Map>
      </Box>
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={!position} loading={isPending}>Save</Button>
      </Group>
    </Stack>
  );
}


