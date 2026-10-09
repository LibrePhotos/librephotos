import { ActionIcon, Box, Group, Modal, Stack, Text, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPencil, IconMapPin as MapPin } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { Photo as PhotoType } from "../../api_client/photos/types";
import { LocationMap } from "../LocationMap";
import { LocationPickerModal } from "../map/LocationPickerModal";

interface LocationSectionProps {
  photoDetail: Partial<PhotoType>;
  mapHeight?: number;
  isPublic?: boolean;
}

export function LocationSection({ photoDetail, mapHeight = 250, isPublic = false }: LocationSectionProps) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  return (
    <Group>
      <Stack w="100%">
        <Group wrap="nowrap" align="center">
          <MapPin />
          <Text
            c={photoDetail.search_location ? undefined : "dimmed"}
            title={photoDetail.search_location ?? undefined}
            style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {photoDetail.search_location || t("lightbox.sidebar.no_location", "No location yet")}
          </Text>
          {!isPublic && (
            <Tooltip label={t("lightbox.sidebar.update_location", "Update location")}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={t("lightbox.sidebar.update_location", "Update location")}
                onClick={open}
              >
                <IconPencil size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
        {photoDetail.exif_gps_lat && photoDetail.exif_gps_lon && (
          <Box h={mapHeight}>
            {/* No key per photo: LocationMap recentres on new coordinates itself, and a
                remount would rebuild the WebGL map on every arrow-key step. */}
            <LocationMap photos={[photoDetail]} />
          </Box>
        )}
      </Stack>
      {!isPublic && (
        <Modal opened={opened} onClose={close} title={t("lightbox.sidebar.pick_location", "Pick location")} centered>
          <LocationPickerModal
            imageHash={photoDetail.image_hash}
            onClose={close}
            initialLat={photoDetail.exif_gps_lat ?? undefined}
            initialLon={photoDetail.exif_gps_lon ?? undefined}
          />
        </Modal>
      )}
    </Group>
  );
}
