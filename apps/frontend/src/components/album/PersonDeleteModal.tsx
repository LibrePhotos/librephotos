import React from "react";
import { useTranslation } from "react-i18next";
import type { Person } from "../../api_client/albums/hooks";
import { ConfirmModal } from "../modals/ConfirmModal";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Named in the question, and its faces in what happens to them. */
  person: Pick<Person, "name" | "face_count">;
}>;

/** Asks before deleting a person: from the People page and from the person's own page. */
export function PersonDeleteModal({ opened, onClose, onConfirm, person }: Props) {
  const { t } = useTranslation();
  return (
    <ConfirmModal
      opened={opened}
      onClose={onClose}
      onConfirm={() => {
        onConfirm();
        onClose();
      }}
      title={t("personalbum.deletepersonnamed", { name: person.name })}
      message={
        <>
          {t("personalbum.deletepersonremoved", { name: person.name })}{" "}
          {person.face_count > 0 && t("personalbum.deletepersonfaces", { count: person.face_count, name: person.name })}
        </>
      }
      confirmLabel={t("personalbum.deleteperson")}
    />
  );
}
