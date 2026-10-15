import { Alert, Button } from "@mantine/core";
import { IconArchive, IconEyeOff, IconTrash } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { TrashExpiryText } from "../lightbox/TrashedItem";
import type { PhotoActions } from "../lightbox/usePhotoActions";

type Status = {
  color: string;
  icon: React.ReactNode;
  title: string;
  undoLabel: string;
  undo: () => void;
  inTrash: boolean;
};

/** The strongest state wins: in the trash, then hidden (gone everywhere), then archived (#545). */
function photoStatus(actions: PhotoActions, t: TFunction): Status | null {
  if (actions.inTrash) {
    return {
      color: "red",
      icon: <IconTrash size={18} />,
      title: t("photopage.status.trashed"),
      undoLabel: t("photopage.actions.restore"),
      undo: actions.toggleTrash,
      inTrash: true,
    };
  }
  if (actions.isHidden) {
    return {
      color: "gray",
      icon: <IconEyeOff size={18} />,
      title: t("photopage.status.hidden"),
      undoLabel: t("photopage.actions.show"),
      undo: actions.toggleHidden,
      inTrash: false,
    };
  }
  if (actions.isArchived) {
    return {
      color: "teal",
      icon: <IconArchive size={18} />,
      title: t("photopage.status.archived"),
      undoLabel: t("photopage.actions.unarchive"),
      undo: actions.toggleArchived,
      inTrash: false,
    };
  }
  return null;
}

/**
 * A trashed, hidden or archived photo says so, with the way back, where its actions are. A trashed
 * one also says since when, and when the trash retention deletes it (#2203).
 */
export function PhotoStatus({ actions, trashedAt }: Readonly<{ actions: PhotoActions; trashedAt?: string | null }>) {
  const { t } = useTranslation();
  const status = photoStatus(actions, t);
  if (!status) return null;
  return (
    <Alert variant="light" color={status.color} icon={status.icon} title={status.title}>
      {status.inTrash && <TrashExpiryText trashedAt={trashedAt} mb="xs" />}
      <Button variant="light" color={status.color} size="xs" onClick={status.undo}>
        {status.undoLabel}
      </Button>
    </Alert>
  );
}
