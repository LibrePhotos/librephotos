import { ActionIcon, Box, Group, Modal, Stack, Text, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconEdit as Edit, IconMapPin as MapPin } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { Photo as PhotoType } from "../../api_client/photos/types";
import { LocationMap } from "../LocationMap";
import { LocationPickerModal } from "../map/LocationPickerModal";

interface LocationSectionProps {
  photoDetail: PhotoType;
  mapHeight?: number;
}

export function LocationSection({ photoDetail, mapHeight = 250 }: LocationSectionProps) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  return (
    <Group>
      <Stack w="100%">
        <Group gap="xs" wrap="nowrap" align="center">
          <MapPin />
          <Text style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {photoDetail.search_location || t("lightbox.sidebar.no_location", "No location yet")}
          </Text>
          <Tooltip label={t("lightbox.sidebar.update_location", "Update location")}>
            <ActionIcon variant="subtle" color="dark" onClick={open}>
              <Edit size={17} />
            </ActionIcon>
          </Tooltip>
        </Group>
        {photoDetail.exif_gps_lat && photoDetail.exif_gps_lon && (
          <Box h={mapHeight}>
            <LocationMap photos={[photoDetail]} />
          </Box>
        )}
      </Stack>
      <Modal opened={opened} onClose={close} title={t("lightbox.sidebar.pick_location", "Pick location")} centered>
        <LocationPickerModal
          imageHash={photoDetail.image_hash}
          onClose={close}
          initialLat={photoDetail.exif_gps_lat ?? undefined}
          initialLon={photoDetail.exif_gps_lon ?? undefined}
        />
      </Modal>
    </Group>
  );
}
