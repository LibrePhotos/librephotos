import type { Photo } from "@librephotos/api-client";
import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { IconBookmark, IconMapPin, IconNote, IconPhoto, IconTag, IconUsers } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDrawnFaceResult, useSetFacesPersonLabelMutation } from "../../api_client/faces";
import { autoTagsOf, userCaptionOf } from "../../api_client/photos/captions";
import { useFetchPhotoAlbumsQuery } from "../../api_client/photos/hooks";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { useFetchPhotoTagsQuery } from "../../api_client/tags/hooks";
import { AlbumsSection } from "../lightbox/AlbumsSection";
import { Description } from "../lightbox/Description";
import type { FaceLocationType } from "../lightbox/lightbox.types";
import { LocationSection } from "../lightbox/LocationSection";
import { PeopleSection } from "../lightbox/PeopleSection";
import { SimilarPhotosSection } from "../lightbox/SimilarPhotosSection";
import { TagsSection } from "../lightbox/TagsSection";
import { ModalPersonEdit } from "../modals/ModalPersonEdit";
import { useYourPlaceAt } from "../places/useYourPlaceAt";
import type { AddableDetail } from "./AddDetailsCard";
import { AddDetailsCard } from "./AddDetailsCard";
import { CameraCard } from "./CameraCard";
import { FileCard } from "./FileCard";
import { PhotoCard } from "./PhotoCard";

const ADDABLE: readonly AddableDetail[] = ["caption", "tags", "place", "face"];

/** How many similar photos the page shows; the list is capped by the server too. */
const SIMILAR_PHOTOS_SHOWN = 12;

type Props = Readonly<{
  photo: Photo;
  setFaceLocation: (location: FaceLocationType) => void;
  faceDrawing: { isDrawing: boolean; start: () => void; cancel: () => void };
  /** Why a face cannot be drawn right now (a rotation in progress), if it cannot. */
  addFaceBlockedReason?: string;
}>;

/** Which of the details that can be added are missing (undefined while that is not known yet). */
function useMissingDetails(photo: Photo) {
  const { data: settings } = useGetSettingsQuery();
  const { data: tags } = useFetchPhotoTagsQuery(photo.id);
  const autoTags = autoTagsOf(photo.captions_json, settings?.tagging_model ?? "openclip_vitb32") ?? [];
  return {
    caption: !userCaptionOf(photo.captions_json) && autoTags.length === 0,
    // Unknown while the photo's tags load: neither the card nor the offer shows yet.
    tags: tags === undefined ? undefined : tags.length === 0,
    place: !photo.search_location && (photo.exif_gps_lat == null || photo.exif_gps_lon == null),
    face: photo.people.length === 0,
  };
}

/**
 * The owner's cards, ordered by what people ask about a photo: who, what,
 * where, how and which file, then its albums and similar photos. Each card
 * keeps the editor the lightbox has for it. Details the photo lacks fold
 * into one "Add details" card instead of a column of "No ..." rows; picking
 * one opens its editor in its own card.
 */
export function OwnerPhotoDetails({ photo, setFaceLocation, faceDrawing, addFaceBlockedReason }: Props) {
  const { t } = useTranslation();
  const missing = useMissingDetails(photo);
  // A box drawn on a photo without faces yet: People shows what became of it (#1117)
  const drawn = useDrawnFaceResult(photo.image_hash);
  // The details the user chose to add: their cards show although still empty.
  const [adding, setAdding] = useState<AddableDetail[]>([]);
  const [editedFace, setEditedFace] = useState<{ face_id: number; face_url: string } | null>(null);
  const { mutate: setFacesPersonLabel } = useSetFacesPersonLabelMutation();
  const { data: albums } = useFetchPhotoAlbumsQuery(photo.image_hash);
  const yourPlace = useYourPlaceAt(photo.exif_gps_lat, photo.exif_gps_lon);
  const similarCount = photo.similar_photos.filter(similar => similar.image_hash !== photo.image_hash).length;

  const shows = (detail: AddableDetail) => missing[detail] === false || adding.includes(detail);
  const canMarkFace = !photo.video;
  const add = (detail: AddableDetail) => {
    if (detail === "face") faceDrawing.start();
    else setAdding(current => [...current, detail]);
  };
  // A face is drawn on a photo, not a video, and not offered again while one is being drawn.
  const offered = (detail: AddableDetail) => missing[detail] === true && !adding.includes(detail);
  const addable = ADDABLE.filter(detail =>
    detail === "face" ? offered(detail) && canMarkFace && !faceDrawing.isDrawing : offered(detail)
  );

  return (
    <>
      {(shows("face") || faceDrawing.isDrawing || drawn !== null) && (
        <PhotoCard icon={IconUsers} color="blue" title={t("lightbox.sidebar.people")} count={photo.people.length}>
          {heading => (
            <PeopleSection
              photoDetail={photo}
              isPublic={false}
              heading={heading}
              setFaceLocation={setFaceLocation}
              onPersonEdit={(faceId, faceUrl) => setEditedFace({ face_id: faceId, face_url: faceUrl })}
              // The hook says so once the server confirmed.
              notThisPerson={faceId => setFacesPersonLabel({ faceIds: [faceId], personName: UNKNOWN_PERSON_NAME })}
              onAddFaceRequest={canMarkFace ? faceDrawing.start : undefined}
              onCancelAddFace={faceDrawing.cancel}
              isDrawingFace={faceDrawing.isDrawing}
              addFaceBlockedReason={addFaceBlockedReason}
            />
          )}
        </PhotoCard>
      )}
      {shows("caption") && (
        <PhotoCard icon={IconNote} color="orange" title={t("lightbox.sidebar.caption")}>
          {heading => (
            <Description photoDetail={photo} isPublic={false} heading={heading} startEditing={missing.caption} />
          )}
        </PhotoCard>
      )}
      {shows("tags") && (
        <PhotoCard icon={IconTag} color="teal" title={t("lightbox.sidebar.tags")}>
          {heading => <TagsSection photoDetail={photo} heading={heading} startEditing={missing.tags === true} />}
        </PhotoCard>
      )}
      {shows("place") && (
        <PhotoCard icon={IconMapPin} color="red" title={t("photopage.place")}>
          {heading => (
            <LocationSection
              photoDetail={photo}
              mapHeight={200}
              heading={heading}
              startEditing={missing.place}
              yourPlace={yourPlace}
            />
          )}
        </PhotoCard>
      )}
      {addable.length > 0 && <AddDetailsCard missing={addable} onAdd={add} />}
      <CameraCard photo={photo} />
      <FileCard photo={photo} />
      {!!albums && albums.length > 0 && (
        <PhotoCard icon={IconBookmark} color="indigo" title={t("lightbox.sidebar.albums")} count={albums.length}>
          <AlbumsSection imageHash={photo.image_hash} showTitle={false} />
        </PhotoCard>
      )}
      {similarCount > 0 && (
        <PhotoCard icon={IconPhoto} color="cyan" title={t("lightbox.sidebar.similarphotos")}>
          <SimilarPhotosSection photoDetail={photo} maxItems={SIMILAR_PHOTOS_SHOWN} showTitle={false} />
        </PhotoCard>
      )}
      <ModalPersonEdit
        isOpen={editedFace !== null}
        onRequestClose={() => setEditedFace(null)}
        selectedFaces={editedFace ? [editedFace] : []}
      />
    </>
  );
}
