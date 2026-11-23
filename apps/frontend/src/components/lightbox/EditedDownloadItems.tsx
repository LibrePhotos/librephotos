import type { Photo } from "@librephotos/api-client";
import { Menu } from "@mantine/core";
import { IconDownload, IconPhoto } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { saveMediaFile } from "../../api_client/media/saveMedia";
import { notification } from "../../service/notifications";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";
import { editedDownloads } from "./editedDownloads";

/**
 * The owner's ⋮ items for an edited photo: Download edited (the edited JPEG, once the server has
 * made it at full size; until then it says why it waits) and Download original (the untouched
 * file), each saved under its own name. Nothing for a photo without an edit. In the lightbox's ⋮
 * menu after a divider; at the top of the photo page's Download menu without one.
 */
export function EditedDownloadItems({ photo, divider = true }: Readonly<{ photo: Photo; divider?: boolean }>) {
  const { t } = useTranslation();
  const downloads = editedDownloads(photo);
  if (!downloads) return null;
  const { edited, original } = downloads;
  const save = (url: string, name: string) => {
    saveMediaFile(url, name).catch(() => notification.error(t("lightbox.download.failed")));
  };
  const editedReason =
    edited.kind === "pending"
      ? t("lightbox.original.reason.rendering")
      : edited.kind === "failed" && t("lightbox.download.editedFailed");
  const editedItem = (
    <Menu.Item
      leftSection={<IconDownload size={ICON_SIZE.menu} />}
      onClick={() => {
        if (edited.kind === "ready") save(edited.url, edited.name);
      }}
    >
      {t("lightbox.download.edited")}
    </Menu.Item>
  );
  return (
    <>
      {divider && <Menu.Divider />}
      {editedReason ? (
        <DisabledReason reason={editedReason} position="left">
          {editedItem}
        </DisabledReason>
      ) : (
        editedItem
      )}
      <Menu.Item leftSection={<IconPhoto size={ICON_SIZE.menu} />} onClick={() => save(original.url, original.name)}>
        {t("lightbox.download.original")}
      </Menu.Item>
    </>
  );
}
