import type { Photo } from "@librephotos/api-client";
import { ActionIcon, Button, Center, Modal, Stack, Tooltip } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { IconArrowLeft } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { usePhotoEditQuery } from "../../api_client/editing/photoEdits";
import { mediaUrl } from "../../api_client/media/mediaUrl";
import { ErrorState } from "../common/ErrorState";
import { FeatureBoundary, FeatureFallback } from "../common/FeatureBoundary";
import { PageLoader } from "../common/PageLoader";
import { TOOLBAR_BUTTON, TOOLBAR_ICON_SIZE } from "../lightbox/LightboxToolbarButton";
import { mediaVersion } from "../lightbox/useZoomOriginal";
import { ViewerDarkScope } from "../lightbox/ViewerDarkScope";
import classes from "./PhotoEditor.module.css";
import { EditorWorkspace } from "./shell/EditorWorkspace";
import { useEditSource } from "./useEditSource";

export type PhotoEditorProps = Readonly<{
  /** The photo to edit: the viewer's own still photo, with its details. */
  photo: Photo;
  /** Back to the viewer (after a save, a revert, or leaving). */
  onClose: () => void;
}>;

/**
 * The photo editor, full screen and dark in either colour scheme like the viewer it replaces. A
 * render error inside (the WebGL preview, a panel) shows a Retry and a way back instead of taking
 * the page down.
 */
export function PhotoEditor({ photo, onClose }: PhotoEditorProps) {
  return (
    <Modal.Root opened onClose={() => {}} fullScreen closeOnEscape={false}>
      <Modal.Overlay color="black" backgroundOpacity={1} />
      <Modal.Content bg="transparent">
        <Modal.Body p={0} data-autofocus tabIndex={-1} className={classes.body}>
          <ViewerDarkScope className={classes.scope}>
            <FeatureBoundary
              name="photoEditor"
              fallback={({ reset }) => (
                <EditorFrame onClose={onClose}>
                  <FeatureFallback reset={reset} />
                </EditorFrame>
              )}
            >
              <EditorLoader photo={photo} onClose={onClose} />
            </FeatureBoundary>
          </ViewerDarkScope>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}

/** The edit and the source load together; the workspace opens when both are in. */
function EditorLoader({ photo, onClose }: PhotoEditorProps) {
  const { t } = useTranslation();
  const editQuery = usePhotoEditQuery(photo.id);
  const { source, failed, retry } = useEditSource(photo.id);
  // Only an answer fetched for this opening: a cached edit may be older than a rotation (which the
  // server composes into the edit) or a save from another tab.
  const edit = editQuery.isFetchedAfterMount ? editQuery.data : undefined;
  if (edit && source) return <EditorWorkspace photo={photo} edit={edit} source={source} onClose={onClose} />;
  const failure = (editQuery.isError && !edit) || failed;
  return (
    <EditorFrame onClose={onClose}>
      {failure ? (
        <Stack align="center" gap="xs">
          <ErrorState
            failure={{
              onRetry: () => {
                if (editQuery.isError) void editQuery.refetch();
                if (failed) retry();
              },
              retrying: editQuery.isFetching,
            }}
          />
          <Button variant="subtle" color="gray" onClick={onClose}>
            {t("editor.backToPhoto")}
          </Button>
        </Stack>
      ) : (
        <>
          <EditorPlaceholder photo={photo} />
          <PageLoader label={t("editor.loading")} />
        </>
      )}
    </EditorFrame>
  );
}

/**
 * While the edit source loads (a RAW file takes a second or two): the picture the viewer just
 * showed, dimmed under the loader, so the editor opens on the photo instead of on an empty screen.
 * The URL is the viewer's, so the browser answers it from its cache.
 */
function EditorPlaceholder({ photo }: Readonly<{ photo: Photo }>) {
  return (
    <img
      className={classes.placeholder}
      src={`${mediaUrl.bigThumbnail(photo.image_hash)}${mediaVersion(0, photo)}`}
      alt=""
      data-editor-placeholder="true"
    />
  );
}

/** The editor's frame before its workspace is up: a way back and the content in the middle. */
function EditorFrame({ onClose, children }: Readonly<{ onClose: () => void; children: React.ReactNode }>) {
  const { t } = useTranslation();
  useHotkeys([["Escape", onClose]]);
  return (
    <div className={classes.frame}>
      <div className={classes.frameBar}>
        <Tooltip label={t("editor.close")} position="bottom">
          <ActionIcon {...TOOLBAR_BUTTON} aria-label={t("editor.close")} onClick={onClose}>
            <IconArrowLeft size={TOOLBAR_ICON_SIZE} />
          </ActionIcon>
        </Tooltip>
      </div>
      <Center className={classes.frameBody}>{children}</Center>
    </div>
  );
}
