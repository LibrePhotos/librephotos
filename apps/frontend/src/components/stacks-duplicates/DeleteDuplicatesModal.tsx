import React from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal } from "../modals/ConfirmModal";

export function DeleteDuplicatesModal({
  opened,
  count,
  onClose,
  onConfirm,
}: {
  opened: boolean;
  count: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  // Removing a group cannot be undone, and for a resolved one it also drops the Revert history
  return (
    <ConfirmModal
      opened={opened}
      onClose={onClose}
      onConfirm={onConfirm}
      irreversible
      title={t("duplicates.deleteconfirmtitle", { count })}
      message={t("duplicates.deleteconfirmdescription")}
      confirmLabel={t("delete")}
    />
  );
}
