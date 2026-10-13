import React from "react";
import { useTranslation } from "react-i18next";
import { useRemovePhotosFromPersonMutation } from "../../api_client/albums/hooks";
import { ConfirmModal } from "../modals/ConfirmModal";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  personId: string;
  personName: string;
  /** `Photo.id` of each selected photo. */
  photoIds: string[];
  /** After the request is sent: the selection ends. */
  onRemoved: () => void;
}>;

/** Asks before taking a person off the selected photos of their page. */
export function PersonRemovePhotosModal({ opened, onClose, personId, personName, photoIds, onRemoved }: Props) {
  const { t } = useTranslation();
  const removePhotos = useRemovePhotosFromPersonMutation();

  return (
    <ConfirmModal
      opened={opened}
      onClose={onClose}
      onConfirm={() => {
        removePhotos.mutate({ personId, personName, photoIds });
        onClose();
        onRemoved();
      }}
      title={t("personalbum.removephotostitle", { count: photoIds.length, name: personName })}
      message={t("personalbum.removephotosdescription", { count: photoIds.length, name: personName })}
      // The title names the person: a long name would not fit the button
      confirmLabel={t("selectionactions.removefromperson")}
    />
  );
}
