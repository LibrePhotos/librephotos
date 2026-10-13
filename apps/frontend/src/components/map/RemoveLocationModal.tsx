import type { ParseKeys } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { invalidatePlaces } from "../../api_client/albums/invalidatePlaces";
import { useUpdatePhotoMutation } from "../../api_client/photos/hooks/useUpdatePhotoMutation";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { ConfirmModal } from "../modals/ConfirmModal";
import { writeDestination, writeModeOf, type WriteDestination } from "../settings/metadataWrite";

/** What the removal does to the photo's file, by where "Write edits to files" sends a location (#2290). */
const FILE_KEYS: Readonly<Record<WriteDestination, ParseKeys>> = {
  none: "locationpicker.remove_file.none",
  sidecar: "locationpicker.remove_file.sidecar",
  file: "locationpicker.remove_file.file",
};

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
  const { data: user } = useCurrentUserSelfDetailsQuery();
  // Nothing about the file until the user's settings are loaded, so it never says "not changed" by mistake.
  const fileNote = user && t(FILE_KEYS[writeDestination("location", writeModeOf(user.save_metadata_to_disk))]);

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
      message={fileNote ? `${t("locationpicker.remove_message")} ${fileNote}` : t("locationpicker.remove_message")}
      confirmLabel={t("locationpicker.remove_location")}
    />
  );
}
