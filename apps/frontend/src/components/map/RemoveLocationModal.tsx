import React from "react";
import { useTranslation } from "react-i18next";
import { invalidatePlaces } from "../../api_client/albums/invalidatePlaces";
import { useUpdatePhotoMutation } from "../../api_client/photos/hooks/useUpdatePhotoMutation";
import { ConfirmModal } from "../modals/ConfirmModal";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  imageHash: string;
  /** The location is gone on the server. */
  onRemoved: () => void;
}>;

/**
 * Asks before removing a photo's location (#2209). Both coordinates go to the server as null;
 * on an error the mutation's toast reports it and the dialog stays open to try again.
 */
export function RemoveLocationModal({ opened, onClose, imageHash, onRemoved }: Props) {
  const { t } = useTranslation();
  const { mutate, isPending } = useUpdatePhotoMutation();

  const remove = () =>
    mutate(
      { id: imageHash, data: { exif_gps_lat: null, exif_gps_lon: null } },
      {
        onSuccess: () => {
          invalidatePlaces();
          onRemoved();
        },
      }
    );

  return (
    <ConfirmModal
      opened={opened}
      onClose={onClose}
      onConfirm={remove}
      loading={isPending}
      title={t("locationpicker.remove_title")}
      message={t("locationpicker.remove_message")}
      confirmLabel={t("locationpicker.remove_location")}
    />
  );
}
