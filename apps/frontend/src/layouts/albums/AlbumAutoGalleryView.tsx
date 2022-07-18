import { Avatar, AvatarsGroup, Breadcrumbs, Button, Divider, Group, Loader, Text, Title } from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import _ from "lodash";
import moment from "moment";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Map2, SettingsAutomation, Users } from "tabler-icons-react";

import { fetchAlbumsAutoGalleries } from "../../actions/albumsActions";
import { fetchPhotoDetail } from "../../actions/photosActions";
import { serverAddress } from "../../api_client/apiClient";
import { AlbumLocationMap } from "../../components/AlbumLocationMap";
import { Tile } from "../../components/Tile";
import { LightBox } from "../../components/lightbox/LightBox";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { HeaderComponent } from "./HeaderComponent";

const SIDEBAR_WIDTH = 85;

type Props = { match: any };

export const AlbumAutoGalleryView = (props: Props) => {
  const { height, width } = useViewportSize();
  const [lightboxImageIndex, setLightboxImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [entrySquareSize, setEntrySquareSize] = useState(200);

  const dispatch = useAppDispatch();
  const { match } = props;
  const { albumsAutoGalleries, fetchingAlbumsAutoGalleries } = useAppSelector(store => store.albums);
  const { t } = useTranslation();
  useEffect(() => {
    fetchAlbumsAutoGalleries(dispatch, match.params.albumID);
  }, []);

  useEffect(() => {
    calculateEntrySquareSize();
  }, [height, width]);

  const calculateEntrySquareSize = () => {
    let numEntrySquaresPerRow = 10;
    if (width < 600) {
      numEntrySquaresPerRow = 2;
    } else if (width < 800) {
      numEntrySquaresPerRow = 4;
    } else if (width < 1000) {
      numEntrySquaresPerRow = 6;
    } else if (width < 1200) {
      numEntrySquaresPerRow = 8;
    }

    const columnWidth = width - SIDEBAR_WIDTH - 20;

    const entrySquareSize = columnWidth / numEntrySquaresPerRow;
    setEntrySquareSize(entrySquareSize);
  };
  const getPhotoDetails = image_hash => {
    dispatch(fetchPhotoDetail(image_hash));
  };

  const { albumID } = match.params;
  if (albumsAutoGalleries.hasOwnProperty(albumID) && !fetchingAlbumsAutoGalleries) {
    const album = albumsAutoGalleries[match.params.albumID];
    const photos = _.sortBy(album.photos, "exif_timestamp").map((el, idx) => ({ ...el, idx: idx }));
    const byDate = _.groupBy(_.sortBy(photos, "exif_timestamp"), photo => photo.exif_timestamp.split("T")[0]);

    const subtitle = ` ${t("numberofphotos", {
      number: album.photos.length,
    })},
        ${moment(album.photos[0].exif_timestamp).format("MMMM Do YYYY")} -
        ${moment(album.photos[album.photos.length - 1].exif_timestamp).format(" MMMM Do YYYY")}`;
    return (
      <div>
        <div style={{ paddingTop: 10, paddingRight: 5 }}>
          <HeaderComponent
            icon={<SettingsAutomation size={50} />}
            title={album.title}
            fetching={fetchingAlbumsAutoGalleries}
            subtitle={subtitle}
          />
        </div>

        <div
          style={{
            position: "fixed",
            top: TOP_MENU_HEIGHT + 10,
            right: 10,
            float: "right",
            zIndex: 500,
          }}
        >
          <Button
            color={showMap ? "blue" : "grey"}
            onClick={() => {
              setShowMap(!showMap);
            }}
            rightIcon={<Map2 />}
          >
            {showMap ? t("autoalbumgallery.hidemap") : t("autoalbumgallery.showmap")}
          </Button>
        </div>

        <Divider hidden />

        <div>
          {album.people.length > 0 && (
            <div>
              <Title order={3}>
                <Users /> {t("people")}
              </Title>

              <AvatarsGroup limit={5}>
                {album.people.map((person, idx) => (
                  <Avatar
                    radius="xl"
                    component="a"
                    href={`/person/${person.id}`}
                    src={serverAddress + person.face_url}
                    alt={person.name}
                  />
                ))}
              </AvatarsGroup>
            </div>
          )}

          <div>
            {_.toPairs(byDate).map((v, i) => {
              const locations = v[1]
                .filter(photo => !!photo.geolocation_json.features)
                .map(photo => {
                  if (photo.geolocation_json.features) {
                    return photo.geolocation_json.features[photo.geolocation_json.features.length - 3].text;
                  }
                  return "";
                });
              return (
                <div>
                  <Divider hidden />
                  <Group>
                    <Calendar />
                    <div>
                      <Title order={5}>{`Day ${i + 1} - ${moment(v[0]).format("MMMM Do YYYY")}`}</Title>
                      <Text color="dimmed">
                        <Breadcrumbs separator="/">
                          <>{_.uniq(locations).map(e => ({ key: e, content: e }))}</>
                        </Breadcrumbs>
                      </Text>
                    </div>
                  </Group>

                  {locations.length > 0 && showMap && (
                    <div
                      style={{
                        margin: "auto",
                        paddingLeft: 3,
                        paddingRight: 2.5,
                        paddingTop: 10,
                        paddingBottom: 5,
                      }}
                    >
                      <AlbumLocationMap photos={v[1]} />
                    </div>
                  )}

                  {v[1].map(photo => (
                    <div
                      onClick={() => {
                        const indexOf = albumsAutoGalleries[match.params.albumID].photos
                          .map(i => i.image_hash)
                          .indexOf(photo.image_hash);
                        console.log(indexOf);
                        setLightboxOpen(true);
                        setLightboxImageIndex(indexOf);
                      }}
                      style={{
                        display: "inline-block",
                        paddingTop: 2.5,
                        paddingBottom: 2.5,
                        paddingLeft: 2.5,
                        paddingRight: 2.5,
                        cursor: "pointer",
                      }}
                    >
                      <Tile
                        video={photo.video === true}
                        height={entrySquareSize}
                        width={entrySquareSize}
                        image_hash={photo.image_hash}
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {lightboxOpen && (
          <LightBox
            isPublic={false}
            idx2hash={albumsAutoGalleries[match.params.albumID].photos.map(i => i.image_hash)}
            lightboxImageIndex={lightboxImageIndex}
            lightboxImageId={albumsAutoGalleries[match.params.albumID].photos[lightboxImageIndex].image_hash}
            onCloseRequest={() => setLightboxOpen(false)}
            onImageLoad={() => {
              getPhotoDetails(albumsAutoGalleries[match.params.albumID].photos[lightboxImageIndex].image_hash);
            }}
            onMovePrevRequest={() => {
              const nextIndex =
                (lightboxImageIndex + albumsAutoGalleries[match.params.albumID].photos.length - 1) %
                albumsAutoGalleries[match.params.albumID].photos.length;
              setLightboxImageIndex(nextIndex);
              getPhotoDetails(albumsAutoGalleries[match.params.albumID].photos[nextIndex].image_hash);
            }}
            onMoveNextRequest={() => {
              const nextIndex =
                (lightboxImageIndex + albumsAutoGalleries[match.params.albumID].photos.length + 1) %
                albumsAutoGalleries[match.params.albumID].photos.length;
              setLightboxImageIndex(nextIndex);
              getPhotoDetails(albumsAutoGalleries[match.params.albumID].photos[nextIndex].image_hash);
            }}
          />
        )}
      </div>
    );
  }
  return (
    <div style={{ height: 60, paddingTop: 10 }}>
      <Title order={4}>
        {fetchingAlbumsAutoGalleries ? "Loading..." : "No images found"}
        <Loader size="sm" />
      </Title>
    </div>
  );
};
