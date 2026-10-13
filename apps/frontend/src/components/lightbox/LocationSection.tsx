import type { Photo as PhotoType } from "@librephotos/api-client";
import { ActionIcon, Box, Group, Modal, Stack, Text, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPencil, IconMapPin as MapPin } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { LocationMap } from "../LocationMap";
import { LocationPickerModal } from "../map/LocationPickerModal";

type LocationSectionProps = {
  /** The coordinates are null where the viewer may not see them; the map then stays hidden. */
  photoDetail: Pick<PhotoType, "image_hash" | "exif_gps_lat" | "exif_gps_lon"> &
    Partial<Pick<PhotoType, "search_location">>;
  mapHeight?: number;
  isPublic?: boolean;
  /**
   * Shown instead of the section's own icon and title, next to its edit
   * controls: the photo page's cards bring their own heading.
   */
  heading?: React.ReactNode;
  /** Open the location picker at once: the photo page's "Add a place" asked for it. */
  startEditing?: boolean;
};

export function LocationSection({
  photoDetail,
  mapHeight = 250,
  isPublic = false,
  heading,
  startEditing = false,
}: LocationSectionProps) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(startEditing && !isPublic);
  // The picker's removal confirmation owns Escape while it is open; both dialogs would close.
  const [nestedOpened, nested] = useDisclosure(false);
  const { exif_gps_lat: lat, exif_gps_lon: lon } = photoDetail;
  // Coordinates the geocoder could not name (#2253) are named by themselves, not "no location".
  const label =
    photoDetail.search_location ||
    (lat != null && lon != null ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : t("lightbox.sidebar.no_location"));
  const editButton = !isPublic && (
    <Tooltip label={t("lightbox.sidebar.update_location")}>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="sm"
        aria-label={t("lightbox.sidebar.update_location")}
        onClick={open}
      >
        <IconPencil size={16} />
      </ActionIcon>
    </Tooltip>
  );
  return (
    <Group>
      <Stack w="100%">
        {heading ? (
          // In a card the whole address shows, under the card's heading.
          <>
            <Group justify="space-between" wrap="nowrap">
              {heading}
              {editButton}
            </Group>
            <Text size="sm" c={photoDetail.search_location ? undefined : "dimmed"}>
              {label}
            </Text>
          </>
        ) : (
          <Group wrap="nowrap" align="center">
            <MapPin />
            <Text
              c={photoDetail.search_location ? undefined : "dimmed"}
              title={label}
              style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {label}
            </Text>
            {editButton}
          </Group>
        )}
        {/* != null: a photo on the equator or the prime meridian has a map too (#2283). */}
        {lat != null && lon != null && (
          <Box h={mapHeight}>
            {/* No key per photo: LocationMap recentres on new coordinates itself, and a
                remount would rebuild the WebGL map on every arrow-key step. */}
            <LocationMap photos={[photoDetail]} />
          </Box>
        )}
      </Stack>
      {!isPublic && (
        <Modal
          opened={opened}
          onClose={close}
          title={t("lightbox.sidebar.pick_location")}
          centered
          closeOnEscape={!nestedOpened}
        >
          <LocationPickerModal
            imageHash={photoDetail.image_hash}
            onClose={close}
            initialLat={lat ?? undefined}
            initialLon={lon ?? undefined}
            initialPlace={photoDetail.search_location || undefined}
            onNestedDialogChange={nestedOpen => (nestedOpen ? nested.open() : nested.close())}
          />
        </Modal>
      )}
    </Group>
  );
}
