import { Button, Group, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconMapPinOff } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { invalidatePlaces } from "../../api_client/albums/invalidatePlaces";
import { useLocatedNearbyQuery } from "../../api_client/photos/hooks/useLocatedNearbyQuery";
import { useUpdatePhotoMutation } from "../../api_client/photos/hooks/useUpdatePhotoMutation";
import { useRegisterDraft } from "../lightbox/unsavedDrafts";
import { WriteBackHint } from "../lightbox/WriteBackHint";
import { LocationPickerBody } from "./LocationPickerBody";
import { hasPosition, NearbyLocatedStrip } from "./NearbyLocatedStrip";
import { nearbyWindow } from "./nearbyTime";
import { RemoveLocationModal } from "./RemoveLocationModal";
import { useLocationPicker, useStartNearNearest } from "./useLocationPicker";

type Props = Readonly<{
  imageHash: string;
  onClose: () => void;
  initialLat?: number;
  initialLon?: number;
  /** The place name the photo has for its location, shown until another spot is picked. */
  initialPlace?: string;
  /** When the photo was taken (`exif_timestamp`): offers the photos taken around then to copy from. */
  takenAt?: string | null;
  /** The removal confirmation opened or closed: the dialog around the picker leaves Escape to it. */
  onNestedDialogChange?: (opened: boolean) => void;
}>;

export function LocationPickerModal({
  imageHash,
  onClose,
  initialLat,
  initialLon,
  initialPlace,
  takenAt,
  onNestedDialogChange,
}: Props) {
  const { t } = useTranslation();
  // Fixed at mount: the photo's own location, which only it can remove.
  const [initialPosition] = useState<[number, number] | null>(() =>
    initialLat !== undefined && initialLon !== undefined ? [initialLat, initialLon] : null
  );
  const picker = useLocationPicker(initialPosition, initialPlace);
  const span = takenAt ? { first: takenAt, last: takenAt } : null;
  const nearby = useLocatedNearbyQuery(nearbyWindow(span));
  // The photo itself is no photo to copy from.
  const others = nearby.data?.filter(photo => photo.image_hash !== imageHash);
  // Without a location of its own, the map opens where the nearest of those was taken.
  useStartNearNearest(picker, others?.find(hasPosition));
  const [removeOpened, removeDialog] = useDisclosure(false, {
    onOpen: () => onNestedDialogChange?.(true),
    onClose: () => onNestedDialogChange?.(false),
  });

  const { mutate, isPending } = useUpdatePhotoMutation();
  // Opening the picker on the photo's own location is no change.
  useRegisterDraft("location", picker.changed);

  const handleSave = () => {
    if (!picker.position) return;
    const [lat, lon] = picker.position;
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

  return (
    <Stack>
      {/* An optional shortcut: when the photos cannot be read (the failure is toasted), it is left out. */}
      {span && !nearby.isError && (
        <NearbyLocatedStrip photos={others} span={span} position={picker.position} onPick={picker.pickPhoto} />
      )}

      <LocationPickerBody picker={picker} initialPosition={initialPosition} />

      <WriteBackHint field="location" />

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
          <Button onClick={handleSave} disabled={!picker.position} loading={isPending}>
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
