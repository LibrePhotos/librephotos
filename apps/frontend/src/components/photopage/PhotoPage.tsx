import type { Photo } from "@librephotos/api-client";
import { Button, Center, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconAlertCircle } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks";
import { useAuth } from "../../hooks/useAuth";
import { useCopyPhotoToClipboard } from "../../hooks/useCopyPhotoToClipboard";
import { PageLoader } from "../common/PageLoader";
import { Lightbox } from "../lightbox/Lightbox";
import type { FaceLocationType, LightboxItem } from "../lightbox/lightbox.types";
import { useFaceDrawing } from "../lightbox/useFaceDrawing";
import { usePhotoActions } from "../lightbox/usePhotoActions";
import { usePhotoRotation } from "../lightbox/usePhotoRotation";
import { ModalPersonEdit } from "../modals/ModalPersonEdit";
import { PageBody } from "../PageBody";
import { OwnerPhotoDetails } from "./OwnerPhotoDetails";
import { PhotoActionTiles } from "./PhotoActionTiles";
import { PhotoMat } from "./PhotoMat";
import classes from "./PhotoPage.module.css";
import { PhotoPageDraftsGuard } from "./PhotoPageDraftsGuard";
import { PhotoPageHeader } from "./PhotoPageHeader";
import { PhotoStatus } from "./PhotoStatus";
import { SharedPhotoDetails } from "./SharedPhotoDetails";

/** The one photo the page shows, for its owner or for someone it is shared with. */
function PhotoPageContent({ photo }: Readonly<{ photo: Photo }>) {
  const { t } = useTranslation();
  const { userId } = useAuth();
  // As in the lightbox: only the owner gets the editors and the actions that change the photo.
  const isOwner = userId !== null && photo.owner.id === userId;
  const [faceLocation, setFaceLocation] = useState<FaceLocationType>(null);
  const [viewerOpen, { open: openViewer, close: closeViewer }] = useDisclosure(false);
  const actions = usePhotoActions({ photoDetail: photo, isPublic: !isOwner });
  const rotation = usePhotoRotation(isOwner ? photo.image_hash : undefined, photo.image_hash);
  const clearFaceLocation = useCallback(() => setFaceLocation(null), []);
  const faceDrawing = useFaceDrawing(photo.image_hash, clearFaceLocation);
  const clipboard = useCopyPhotoToClipboard();
  const onCopy =
    clipboard.supported && !photo.video
      ? () => clipboard.copy({ imageHash: photo.image_hash, cacheKey: rotation.imageCacheKey })
      : undefined;
  // A box drawn on a turning photo would not line up with it (as in the lightbox).
  const addFaceBlockedReason = rotation.rotationAngle % 360 !== 0 ? t("lightbox.addface.rotated") : undefined;
  // The viewer steps through this one photo; a viewer who is not the owner gets what the grid would give.
  const viewerItems: LightboxItem[] = [
    {
      id: photo.image_hash,
      image_hash: photo.image_hash,
      type: photo.video ? "video" : "image",
      date: photo.exif_timestamp,
      location: photo.search_location ?? undefined,
    },
  ];

  return (
    <PageBody>
      <div className={classes.layout}>
        <PhotoMat
          photo={photo}
          isOwner={isOwner}
          faceLocation={faceLocation}
          rotation={rotation}
          faceDrawing={faceDrawing}
          onOpenViewer={openViewer}
        />
        <div className={classes.column}>
          <PhotoPageHeader photo={photo} isOwner={isOwner} />
          {isOwner ? (
            <>
              <PhotoStatus actions={actions} trashedAt={photo.trashed_at} />
              <PhotoActionTiles
                photo={photo}
                actions={actions}
                onRotate={photo.video ? undefined : rotation.rotate}
                onCopy={onCopy}
                onOpenViewer={openViewer}
              />
              <OwnerPhotoDetails
                photo={photo}
                setFaceLocation={setFaceLocation}
                faceDrawing={faceDrawing}
                addFaceBlockedReason={addFaceBlockedReason}
              />
            </>
          ) : (
            <SharedPhotoDetails photo={photo} onOpenViewer={openViewer} onCopy={onCopy} />
          )}
        </div>
      </div>
      {isOwner && (
        <ModalPersonEdit
          isOpen={!!faceDrawing.drawnBox}
          onRequestClose={faceDrawing.cancel}
          selectedFaces={[]}
          prompt={t("lightbox.addface.whoisit")}
          onPersonChosen={faceDrawing.onPersonChosen}
        />
      )}
      {viewerOpen && (
        <Lightbox
          idx2hash={viewerItems}
          isPublic={!isOwner}
          selectedImage={photo.image_hash}
          onChangedIndex={() => {}}
          onCloseRequest={closeViewer}
        />
      )}
    </PageBody>
  );
}

/**
 * The single-photo page (`/photo/$id`): a direct link, Ctrl/Cmd+click on a
 * tile, a similar photo or a notification. The photo sits large on a mat,
 * and a column beside it (below it on a phone) reads like a caption: the
 * date as the title, the actions as labelled tiles, then a card per subject.
 */
export function PhotoPage({ photoId }: Readonly<{ photoId: string }>) {
  const { t } = useTranslation();
  const { data: photo, isError } = useFetchPhotoDetailsQuery(photoId);

  if (!photoId) {
    return (
      <PageBody>
        <Center>
          <Text>{t("photopage.noid")}</Text>
        </Center>
      </PageBody>
    );
  }

  // A deleted photo, someone else's, or a mistyped link: say so instead of
  // spinning forever.
  if (isError && !photo) {
    return (
      <PageBody>
        <Center py="xl">
          <Stack align="center" gap="xs">
            <IconAlertCircle size={48} />
            <Text fw={600}>{t("photopage.notfound")}</Text>
            <Button component={Link} to="/" variant="light" mt="xs">
              {t("publicalbum.goHome")}
            </Button>
          </Stack>
        </Center>
      </PageBody>
    );
  }

  if (!photo) {
    return (
      <PageBody>
        <PageLoader label={t("photopage.loading")} />
      </PageBody>
    );
  }

  // Everything the page holds (an open editor, a rotation, a face being drawn)
  // belongs to one photo: a similar photo's link starts afresh. Leaving with an
  // unsaved edit asks first (#2284).
  return (
    <PhotoPageDraftsGuard key={photo.image_hash}>
      <PhotoPageContent photo={photo} />
    </PhotoPageDraftsGuard>
  );
}
