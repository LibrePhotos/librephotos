import { IconGlobe as Globe } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { fetchAlbumDate, fetchAlbumDateList } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { PhotosState } from "../../reducers/photosReducer";
import { PhotosetType } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { updatePhotoGroups } from "../photos/common";
import type { PhotoGroup } from "../photos/common";

export function UserPublicPage() {
  const params = useParams();

  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector(state => state.photos as PhotosState);
  const dispatch = useAppDispatch();
  const { auth } = useAppSelector(state => state);
  const [group, setGroup] = useState({} as PhotoGroup);

  useEffect(() => {
    if (group.id && group.page) {
      fetchAlbumDate(dispatch, {
        album_date_id: group.id,
        page: group.page,
        photosetType: PhotosetType.PUBLIC,
        username: params.username,
      });
    }
  }, [group.id, group.page]);

  useEffect(() => {
    fetchAlbumDateList(dispatch, {
      photosetType: PhotosetType.PUBLIC,
      username: params.username,
    });
  }, [dispatch]); // Only run on first render

  return (
    <PhotoListView
      // To-Do: Translate this
      title={
        auth.access && auth.access.name === params.username
          ? "Your public photos"
          : `Public photos of ${params.username}`
      }
      loading={fetchedPhotosetType !== PhotosetType.PUBLIC}
      icon={<Globe size={50} />}
      photoset={photosGroupedByDate}
      idx2hash={photosFlat}
      isPublic={auth.access === null || auth.access.name !== params.username}
      updateGroups={updatePhotoGroups(setGroup)}
      selectable
    />
  );
}
