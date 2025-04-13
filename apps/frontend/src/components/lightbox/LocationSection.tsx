import { Box, Title, Text, Group } from "@mantine/core";
import { IconMapPin } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

import type { Photo as PhotoType } from "../../api_client/photos/photosActions.types";
import { LocationMap } from "../LocationMap";

interface LocationSectionProps {
  photoDetail: PhotoType;
  showTitle?: boolean;
  mapHeight?: number;
}

export function LocationSection({ 
  photoDetail, 
  showTitle = true,
  mapHeight = 250
}: LocationSectionProps) {
  const { t } = useTranslation();
  
  if (!photoDetail.search_location) return null;

  return (
    <div>
      {showTitle && (
        <Group>
          <IconMapPin />
          <Title order={4}>{t("lightbox.sidebar.location", "Location")}</Title>
        </Group>
      )}
      <Text>{photoDetail.search_location}</Text>
      {photoDetail.exif_gps_lat && photoDetail.exif_gps_lon && (
        <Box h={mapHeight} mt="xs">
          <LocationMap photos={[photoDetail]} />
        </Box>
      )}
    </div>
  );
} 