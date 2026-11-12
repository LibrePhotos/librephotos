import type { Photo } from "@librephotos/api-client";
import { ActionIcon } from "@mantine/core";
import { IconPhotoEdit } from "@tabler/icons-react";
import React, { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DisabledReason } from "../common/DisabledReason";
import { canEdit } from "../editor/engine/canEdit";
import { photoEditor } from "../editor/LazyPhotoEditor";
import { useLightboxCommands } from "./lightboxCommands";
import { TOOLBAR_BUTTON, TOOLBAR_ICON_SIZE } from "./LightboxToolbarButton";
import { useEditorJustClosed, usePhotoEditorLauncher } from "./photoEditorLauncher";

type Props = Readonly<{
  /** The viewer's own photo with its details loaded. */
  photo: Photo;
  /** What the lightbox shows it as: a video is not edited. */
  type: string;
}>;

/**
 * Edit (E): opens the photo editor on the viewer's own still photo, drawn switched on for a photo
 * that has an edit. A browser that cannot run the
 * editor (no WebGL2 with float targets) keeps the button, which says why it does nothing.
 */
export function LightboxEditButton({ photo, type }: Props) {
  const { t } = useTranslation();
  const open = usePhotoEditorLauncher();
  const commands = useLightboxCommands();
  const editorClosed = useEditorJustClosed();
  const supported = useMemo(canEdit, []);
  const editable = open !== null && type !== "video" && !photo.video;
  const usable = editable && supported;

  useEffect(() => {
    if (!usable || open === null) return;
    return commands.on("edit", open);
  }, [usable, open, commands]);

  if (!editable) return null;
  // An edited photo: the button is drawn switched on, and its name says so.
  const edited = photo.edit !== null && photo.edit !== undefined && photo.edit.rendition !== "none";
  const label = edited ? t("editor.openEdited") : t("editor.open");
  return (
    <DisabledReason reason={!supported && t("editor.unsupported.short")} label={label} position="bottom">
      <ActionIcon
        {...TOOLBAR_BUTTON}
        aria-label={label}
        mod={{ active: edited }}
        // Back from the editor: the viewer's focus trap puts the focus here.
        data-autofocus={editorClosed || undefined}
        onClick={open}
        // The editor is its own chunk: fetched once the pointer or the focus says it may be wanted.
        onPointerEnter={photoEditor.prefetch}
        onFocus={photoEditor.prefetch}
      >
        <IconPhotoEdit size={TOOLBAR_ICON_SIZE} />
      </ActionIcon>
    </DisabledReason>
  );
}
