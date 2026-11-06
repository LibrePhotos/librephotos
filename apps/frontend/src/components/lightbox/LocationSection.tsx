import type { Photo as PhotoType, UserPlace } from "@librephotos/api-client";
import { ActionIcon, Box, Group, Modal, Stack, Text, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPencil, IconMapPin as MapPin } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { formatCoordinates } from "../../util/exifFormat";
import { LocationMap } from "../LocationMap";
import { LocationPickerModal } from "../map/LocationPickerModal";
import { PLACE_ICONS } from "../places/placeIcons";
import { CoordinatesLine } from "./CoordinatesLine";
import { placeRegion, shortPlace } from "./placeName";
import { ROW_ICON } from "./SectionTitle";
import classes from "./Sidebar.module.css";

type LocationSectionProps = {
  /** The coordinates are null where the viewer may not see them; the map then stays hidden. */
  photoDetail: Pick<PhotoType, "image_hash" | "exif_gps_lat" | "exif_gps_lon"> &
    Partial<Pick<PhotoType, "search_location" | "exif_timestamp" | "gps_altitude">>;
  mapHeight?: number;
  isPublic?: boolean;
  /**
   * Shown instead of the section's own icon and title, next to its edit
   * controls: the photo page's cards bring their own heading.
   */
  heading?: React.ReactNode;
  /** Open the location picker at once: the photo page's "Add a place" asked for it. */
  startEditing?: boolean;
  /**
   * The owner's own place the photo was taken in (#1365), named first, above the map provider's
   * name. Only the owner's views pass it.
   */
  yourPlace?: Pick<UserPlace, "name" | "icon">;
};

/** The owner's own place (#1365), with its icon, above the map provider's name. */
function YourPlaceLine({ place }: Readonly<{ place: NonNullable<LocationSectionProps["yourPlace"]> }>) {
  const { t } = useTranslation();
  const Icon = PLACE_ICONS[place.icon];
  return (
    <Group gap={4} wrap="nowrap" title={t("yourplaces.yourPlace")}>
      <Icon size={16} color="var(--mantine-color-blue-filled)" aria-hidden />
      <Text fw={600} size="sm">
        {place.name}
      </Text>
    </Group>
  );
}

/**
 * The place name, or what stands in for it: the coordinates the geocoder could not
 * name (#2253), else "no location". The owner also gets the coordinates to copy and
 * the altitude (#2276), under the name or as the label; shared and public views never do.
 */
function PlaceLabel({
  photoDetail,
  isPublic,
  inCard,
  yourPlace,
}: Readonly<{
  photoDetail: LocationSectionProps["photoDetail"];
  isPublic: boolean;
  inCard: boolean;
  yourPlace?: LocationSectionProps["yourPlace"];
}>) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const { exif_gps_lat: lat, exif_gps_lon: lon, search_location: place } = photoDetail;
  const ownerCoordinates =
    !isPublic && lat != null && lon != null ? (
      <CoordinatesLine lat={lat} lon={lon} altitude={photoDetail.gps_altitude} size={place ? "xs" : "sm"} />
    ) : null;
  const yourPlaceLine = yourPlace && <YourPlaceLine place={yourPlace} />;
  if (ownerCoordinates && !place) {
    return (
      <>
        {yourPlaceLine}
        {ownerCoordinates}
      </>
    );
  }

  const label = place || formatCoordinates(lat, lon, locale) || t("lightbox.sidebar.no_location");
  const region = place ? placeRegion(place) : "";
  return (
    <>
      {yourPlaceLine}
      {inCard ? (
        // In a card the whole address shows.
        <Text size="sm" c={place ? undefined : "dimmed"}>
          {label}
        </Text>
      ) : place ? (
        // The panel's row: the neighbourhood and town in bold, the region and country dimmed under
        // them, as Immich lists a place, and the whole name on hover.
        <div title={place}>
          <Text size="sm" fw={500} className={classes.placeLine}>
            {shortPlace(place) || place}
          </Text>
          {region && (
            <Text size="xs" c="dimmed" className={classes.placeLine}>
              {region}
            </Text>
          )}
        </div>
      ) : (
        <Text size="sm" c="dimmed" title={label} className={classes.placeLine}>
          {label}
        </Text>
      )}
      {ownerCoordinates}
    </>
  );
}

export function LocationSection({
  photoDetail,
  mapHeight = 250,
  isPublic = false,
  heading,
  startEditing = false,
  yourPlace,
}: LocationSectionProps) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(startEditing && !isPublic);
  // The picker's removal confirmation owns Escape while it is open; both dialogs would close.
  const [nestedOpened, nested] = useDisclosure(false);
  const { exif_gps_lat: lat, exif_gps_lon: lon } = photoDetail;
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
          <>
            <Group justify="space-between" wrap="nowrap">
              {heading}
              {editButton}
            </Group>
            <div>
              <PlaceLabel photoDetail={photoDetail} isPublic={isPublic} inCard yourPlace={yourPlace} />
            </div>
          </>
        ) : (
          <Group wrap="nowrap" align="flex-start">
            <MapPin {...ROW_ICON} />
            <Box flex={1} miw={0}>
              <PlaceLabel photoDetail={photoDetail} isPublic={isPublic} inCard={false} yourPlace={yourPlace} />
            </Box>
            {editButton}
          </Group>
        )}
        {/* != null: a photo on the equator or the prime meridian has a map too (#2283). */}
        {lat != null && lon != null && (
          <Box h={mapHeight} className={classes.map}>
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
          {/* The picked spot belongs to one photo: a step to the next one starts the picker afresh. */}
          <LocationPickerModal
            key={photoDetail.image_hash}
            imageHash={photoDetail.image_hash}
            onClose={close}
            initialLat={lat ?? undefined}
            initialLon={lon ?? undefined}
            initialPlace={photoDetail.search_location || undefined}
            takenAt={photoDetail.exif_timestamp}
            onNestedDialogChange={nestedOpen => (nestedOpen ? nested.open() : nested.close())}
          />
        </Modal>
      )}
    </Group>
  );
}
