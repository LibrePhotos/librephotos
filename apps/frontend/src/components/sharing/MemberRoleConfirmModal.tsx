import React from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal } from "../modals/ConfirmModal";
import type { useMemberRoleChange } from "./useMemberRoleChange";
import { getDisplayName } from "./UserEntry";

type Props = Readonly<{
  roleChange: ReturnType<typeof useMemberRoleChange>;
  albumTitle: string;
}>;

/** Asks before a contributor stops contributing: the photos they added leave the album (#464). */
export function MemberRoleConfirmModal({ roleChange, albumTitle }: Props) {
  const { t } = useTranslation();
  const { pending } = roleChange;
  const name = pending ? getDisplayName(pending.user) : "";
  const toViewer = pending?.role === "viewer";
  return (
    <ConfirmModal
      opened={roleChange.opened}
      onClose={roleChange.close}
      onConfirm={roleChange.confirm}
      loading={roleChange.loading}
      title={t(toViewer ? "collab.viewerTitle" : "collab.removeTitle", { name, title: albumTitle })}
      message={t("collab.photosLeave", { count: pending?.count ?? 0, name })}
      confirmLabel={t(toViewer ? "collab.viewerConfirm" : "collab.removeConfirm")}
    />
  );
}
