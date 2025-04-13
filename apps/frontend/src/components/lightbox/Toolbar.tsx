import { ActionIcon, Group, Loader } from "@mantine/core";
import {
  IconEye as Eye,
  IconEyeOff as EyeOff,
  IconGlobe as Globe,
  IconInfoCircle as InfoCircle,
  IconPlayerPause as PlayerPause,
  IconPlayerPlay as PlayerPlay,
  IconStar as Star,
} from "@tabler/icons-react";
import React, { useState } from "react";

import { shareAddress } from "../../api_client/apiClient";
import { useSetFavoritePhotosMutation } from "../../api_client/photos/favorite";
import { useSetPhotosHiddenMutation, useSetPhotosPublicMutation } from "../../api_client/photos/visibility";
import { copyToClipboard } from "../../util/util";
import { PhotoSchema } from "../../api_client/photos/photosActions.types";
import { z } from "zod";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
type Photo = z.infer<typeof PhotoSchema>;


type Props = Readonly<{
  photosDetail: Photo | null;
  isPhotoDetailsLoading: boolean;
  isPublic: boolean;
  lightboxSidebarShow: boolean;
  closeSidepanel: () => void;
}>;

export function Toolbar(props: Props) {
  const { photosDetail, isPublic, lightboxSidebarShow, closeSidepanel, isPhotoDetailsLoading } = props;
    const [playerPlaying, setPlayerPlaying] = useState(false);
  // Fetch user details using TanStack Query
  const { data: userDetails } = useCurrentUserSelfDetailsQuery();
  const favoriteMinRating = userDetails?.favorite_min_rating ?? 0;

  const setPhotosHidden = useSetPhotosHiddenMutation();
  const setPhotosPublic = useSetPhotosPublicMutation();
  const setFavoritePhotos = useSetFavoritePhotosMutation();

  function playButton(photo: Photo | null) {
    if (!photo || !photo.embedded_media || photo.embedded_media.length === 0) {
      return null;
    }
    
    function togglePlay() {
      if (playerPlaying) {
        setPlayerPlaying(false);
      } else {
        setPlayerPlaying(true);
      }
    }
    return (
      <ActionIcon onClick={() => togglePlay()} variant="transparent">
        {playerPlaying && <Loader color="grey" />}
        {!playerPlaying && playerPlaying ? <PlayerPause /> : <PlayerPlay />}
      </ActionIcon>
    );
  }

  return (
    <Group style={{ paddingBottom: 10, paddingRight: 5 }}>
      {isPhotoDetailsLoading && (
        <ActionIcon loading variant="transparent">
          <Eye color="grey" />
        </ActionIcon>
      )}
      {!isPhotoDetailsLoading && !photosDetail && !isPublic && (
        <ActionIcon loading variant="transparent">
          <Star color="grey" />
        </ActionIcon>
      )}
      {!isPhotoDetailsLoading && !photosDetail && !isPublic && (
        <ActionIcon loading variant="transparent">
          <Globe color="grey" />
        </ActionIcon>
      )}
      {playButton(photosDetail)}
      {!isPhotoDetailsLoading && photosDetail && !isPublic && (
        <ActionIcon
          variant="transparent"
          onClick={() => {
            const { image_hash: imageHash } = photosDetail;
            const val = !photosDetail.hidden;
            setPhotosHidden.mutate({ image_hashes: [imageHash], hidden: val });
          }}
        >
          {photosDetail.hidden ? <EyeOff color="red" /> : <Eye color="grey" />}
        </ActionIcon>
      )}
      {photosDetail && !isPublic && (
        <ActionIcon
          variant="transparent"
          onClick={() => {
            const { image_hash: imageHash } = photosDetail;
            const val = !(photosDetail.rating >= favoriteMinRating);
            setFavoritePhotos.mutate({ image_hashes: [imageHash], favorite: val });
          }}
        >
          <Star color={photosDetail.rating >= favoriteMinRating ? "yellow" : "grey"} />
        </ActionIcon>
      )}
      {photosDetail && !isPublic && (
        <ActionIcon
          variant="transparent"
          onClick={() => {
            const { image_hash: imageHash } = photosDetail;
            const val = !photosDetail.public;
            setPhotosPublic.mutate({ image_hashes: [imageHash], val_public: val });
            copyToClipboard(
              `${shareAddress}/media/thumbnails_big/${imageHash}`
            );
          }}
        >
          <Globe color={photosDetail.public ? "green" : "grey"} />
        </ActionIcon>
      )}
      <ActionIcon onClick={() => closeSidepanel()} variant="transparent">
        <InfoCircle color={lightboxSidebarShow ? "white" : "grey"} />
      </ActionIcon>
    </Group>
  );
}
