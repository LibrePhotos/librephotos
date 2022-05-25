import { ActionIcon, Group } from "@mantine/core";
import React from "react";
import { Eye, EyeOff, Globe, InfoCircle, Star } from "tabler-icons-react";

import { setPhotosFavorite, setPhotosHidden, setPhotosPublic } from "../../actions/photosActions";
import { shareAddress } from "../../api_client/apiClient";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { copyToClipboard } from "../../util/util";

type Props = {
  photosDetail: any;
  isPublic: boolean;
  lightboxSidebarShow: boolean;
  closeSidepanel: () => void;
};

export const Toolbar = (props: Props) => {
  const dispatch = useAppDispatch();
  const { favorite_min_rating } = useAppSelector(store => store.user.userSelfDetails);
  const { photosDetail, isPublic, lightboxSidebarShow, closeSidepanel } = props;
  return (
    <Group style={{ paddingBottom: 10, paddingRight: 5 }}>
      {!photosDetail && (
        <ActionIcon loading disabled={isPublic}>
          <Eye color="grey" />
        </ActionIcon>
      )}
      {!photosDetail && (
        <ActionIcon loading disabled={isPublic}>
          <Star color="grey" />
        </ActionIcon>
      )}
      {!photosDetail && (
        <ActionIcon loading disabled={isPublic}>
          <Globe color="grey" />
        </ActionIcon>
      )}
      {photosDetail && (
        <ActionIcon
          disabled={isPublic}
          onClick={() => {
            const { image_hash } = photosDetail;
            const val = !photosDetail.hidden;
            dispatch(setPhotosHidden([image_hash], val));
          }}
        >
          {photosDetail.hidden ? <EyeOff color="red" /> : <Eye color="grey" />}
        </ActionIcon>
      )}
      {photosDetail && (
        <ActionIcon
          disabled={isPublic}
          onClick={() => {
            const { image_hash } = photosDetail;
            const val = !(photosDetail.rating >= favorite_min_rating);
            dispatch(setPhotosFavorite([image_hash], val));
          }}
        >
          <Star color={photosDetail.rating >= favorite_min_rating ? "yellow" : "grey"} />
        </ActionIcon>
      )}
      {photosDetail && (
        <ActionIcon
          disabled={isPublic}
          onClick={() => {
            const { image_hash } = photosDetail;
            const val = !photosDetail.public;
            dispatch(setPhotosPublic([image_hash], val));
            copyToClipboard(
              // edited from serverAddress.replace('//','') + "/media/thumbnails_big/" + image_hash + ".jpg"
              // as above removed the domain and just left /media/thumbnails_big/" + image_hash + ".jpg"  *DW 12/9/20
              // Not location of shared photo link Reverted to orgiinal *DW 12/13/20
              `${shareAddress}/media/thumbnails_big/${image_hash}.jpg`
            );
          }}
        >
          <Globe color={photosDetail.public ? "green" : "grey"} />
        </ActionIcon>
      )}
      <ActionIcon onClick={() => closeSidepanel()}>
        <InfoCircle color={lightboxSidebarShow ? "white" : "grey"} />
      </ActionIcon>
    </Group>
  );
};
