import { Text } from "@mantine/core";
import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { useIsAuthenticatedQuery } from "../../api_client/auth";
import { autoTagsOf } from "../../api_client/photos/captions";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { sharerName } from "../sharing/sharerGroups";
import { AlbumThreadContext } from "./albumThread";
import type { FaceLocationType } from "./lightbox.types";
import { PeopleSection } from "./PeopleSection";
import { ThingBadges } from "./ThingBadges";

type Props = Readonly<{
  id: string;
  setFaceLocation: (location: FaceLocationType) => void;
}>;

const ignore = () => {};

/**
 * The people and things of a photo someone shared with you, read only (#2721, #2722), and whose it
 * is. Signed-in viewers only: the server lists only the people the owner named, and only when the
 * owner shares their names. A photo the detail does not open for you (a public page's, or one
 * from a shared album) shows nothing here.
 */
export function SharedPhotoDetails({ id, setFaceLocation }: Props) {
  const { t } = useTranslation();
  const { data: isAuthenticated } = useIsAuthenticatedQuery();
  const { data: photo } = useFetchPhotoDetailsQuery(id, !isAuthenticated);
  const { data: siteSettings } = useGetSettingsQuery();
  // In a shared album (#464), a member's photo was added by them, not shared.
  const inAlbum = useContext(AlbumThreadContext) !== undefined;
  if (!photo) return null;

  const things = autoTagsOf(photo.captions_json, siteSettings?.tagging_model ?? "openclip_vitb32") ?? [];
  return (
    <>
      {photo.people.length > 0 && (
        <PeopleSection
          photoDetail={photo}
          isPublic
          setFaceLocation={setFaceLocation}
          onPersonEdit={ignore}
          notThisPerson={ignore}
        />
      )}
      {things.length > 0 && <ThingBadges things={things} imageHash={photo.image_hash} isPublic inCard={false} />}
      {photo.owner && (
        <Text size="sm" c="dimmed">
          {t(inAlbum ? "collab.addedBy" : "sharing.sharedByLine", {
            name: sharerName(photo.owner, photo.owner.username),
          })}
        </Text>
      )}
    </>
  );
}
