import React, { useEffect, useCallback, useState } from "react";
import { fetchAlbumDate, fetchAlbumDateList } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import _ from "lodash";
import { TopMenu } from "../../components/menubars/TopMenu";
import { SideMenuNarrow } from "../../components/menubars/SideMenuNarrow";
import { TopMenuPublic } from "../../components/menubars/TopMenuPublic";
import { SideMenuNarrowPublic } from "../../components/menubars/SideMenuNarrowPublic";
import { LEFT_MENU_WIDTH, TOP_MENU_HEIGHT } from "../../ui-constants";
import { PhotosetType } from "../../reducers/photosReducer";
import type { PhotosState } from "../../reducers/photosReducer";

import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "../../store/store";

type Props = {
  match: any;
};

type fetchedGroup = {
  id: string;
  page: number;
};

export const UserPublicPage = (props: Props) => {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector(
    (state) => state.photos as PhotosState
  );
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const { auth, ui } = useAppSelector((state) => state);
  const [group, setGroup] = useState({} as fetchedGroup);

  useEffect(() => {
    if (group.id && group.page) {
      fetchAlbumDate(dispatch, {
        album_date_id: group.id,
        page: group.page,
        photosetType: PhotosetType.PUBLIC,
        username: props.match.params.username,
      });
    }
  }, [group.id, group.page]);

  useEffect(() => {
    fetchAlbumDateList(dispatch, {
      photosetType: PhotosetType.PUBLIC,
      username: props.match.params.username,
    });
  }, [dispatch]); // Only run on first render

  const getAlbums = (visibleGroups: any) => {
    console.log("visibleGroups", visibleGroups);
    visibleGroups.forEach((group: any) => {
      var visibleImages = group.items;
      if (visibleImages.filter((i: any) => i.isTemp && i.isTemp != undefined).length > 0) {
        var firstTempObject = visibleImages.filter((i: any) => i.isTemp)[0];
        var page = Math.ceil((parseInt(firstTempObject.id) + 1) / 100);
        setGroup({ id: group.id, page: page });
      }
    });
  };

  const throttledGetAlbums = useCallback(
    _.throttle((visibleItems) => getAlbums(visibleItems), 500),
    []
  );

  var menu;
  if (auth.access) {
    menu = (
      <div>
        {ui.showSidebar && <SideMenuNarrow />}
        <TopMenu />
      </div>
    );
  } else {
    menu = (
      <div>
        {ui.showSidebar && <SideMenuNarrowPublic />}
        <TopMenuPublic />
      </div>
    );
  }
  return (
    <div>
      {menu}
      <div
        style={{
          paddingLeft: ui.showSidebar ? LEFT_MENU_WIDTH + 5 : 5,
          paddingRight: 0,
        }}
      >
        <div style={{ paddingTop: TOP_MENU_HEIGHT }}>
          <PhotoListView
            title={
              auth.access && auth.access.name === props.match.params.username
                ? "Your public photos"
                : "Public photos of " + props.match.params.username
            }
            loading={fetchedPhotosetType !== PhotosetType.PUBLIC}
            titleIconName={"globe"}
            isDateView={true}
            photoset={photosGroupedByDate}
            idx2hash={photosFlat}
            isPublic={auth.access === null || auth.access.name !== props.match.params.username}
            updateGroups={throttledGetAlbums}
            selectable={true}
          />
        </div>
      </div>
    </div>
  );
};
