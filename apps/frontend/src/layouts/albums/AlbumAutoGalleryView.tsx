import { Avatar, Box, Breadcrumbs, Button, Divider, Group, Loader, Text, Title } from "@mantine/core";
import { useDisclosure, useViewportSize } from "@mantine/hooks";
import {
  IconCalendar as Calendar,
  IconMap2 as Map2,
  IconSettingsAutomation as SettingsAutomation,
  IconUsers as Users,
} from "@tabler/icons-react";
import _ from "lodash";
import { DateTime } from "luxon";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { useLazyFetchAutoAlbumQuery } from "../../api_client/albums/auto";
import { serverAddress } from "../../api_client/apiClient";
import { photoDetailsApi } from "../../api_client/photos/photoDetail";
import { AlbumLocationMap } from "../../components/AlbumLocationMap";
import { Tile } from "../../components/Tile";
import { LightBox } from "../../components/lightbox/LightBox";
import { i18nResolvedLanguage } from "../../i18n";
import { useAppDispatch } from "../../store/store";
import { LEFT_MENU_WIDTH, TOP_MENU_HEIGHT } from "../../ui-constants";
import { HeaderComponent } from "./HeaderComponent";

const SIDEBAR_WIDTH = LEFT_MENU_WIDTH;

export function AlbumAutoGalleryView() {
  const [entrySquareSize, setEntrySquareSize] = useState(200);
  const [fetchAlbum, { data: album, isFetching }] = useLazyFetchAutoAlbumQuery();
  const [lightboxImageIndex, setLightboxImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [showMap, { toggle: toggleMap }] = useDisclosure(false);
  const dispatch = useAppDispatch();
  const { albumID } = useParams();
  const { height, width } = useViewportSize();
  const { t } = useTranslation();

  const calculateEntrySquareSize = useCallback(() => {
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
    setEntrySquareSize((width - SIDEBAR_WIDTH - 20) / numEntrySquaresPerRow);
  }, [width]);

  function getPhotoDetails(image_hash: string) {
    dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(image_hash));
  }

  useEffect(() => {
    if (albumID) {
      fetchAlbum(albumID);
    }
  }, [albumID, fetchAlbum]);

  useEffect(() => {
    calculateEntrySquareSize();
  }, [calculateEntrySquareSize, height, width]);

  useEffect(() => {}, [album]);

  function formatTimestamp(timestamp: string): string {
    return DateTime.fromISO(timestamp).setLocale(i18nResolvedLanguage()).toLocaleString(DateTime.DATE_MED);
  }

  if (isFetching || !album) {
    return (
      <div style={{ height: 60, paddingTop: 10 }}>
        <Title order={4}>
          {isFetching ? "Loading..." : "No images found"}
          <Loader size="sm" />
        </Title>
      </div>
    );
  }

  const photos = _.sortBy(album.photos, "exif_timestamp").map((el, idx) => ({ ...el, idx }));
  const byDate = _.groupBy(_.sortBy(photos, "exif_timestamp"), photo => photo.exif_timestamp.split("T")[0]);
  const timestampFrom = formatTimestamp(album.photos[0].exif_timestamp);
  const timestampTo = formatTimestamp(album.photos[album.photos.length - 1].exif_timestamp);
  const subtitle = ` ${t("numberofphotos", { number: album.photos.length })}, ${timestampFrom} - ${timestampTo}`;

  return (
    <div>
      <div style={{ paddingTop: 10, paddingRight: 5 }}>
        <HeaderComponent
          icon={<SettingsAutomation size={50} />}
          title={album.title}
          fetching={isFetching}
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
        <Button color={showMap ? "blue" : "grey"} onClick={toggleMap} rightSection={<Map2 />}>
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

            <Avatar.Group>
              {album.people.slice(0, 5).map(person => (
                <Avatar
                  key={person.id}
                  radius="xl"
                  component="a"
                  href={`/person/${person.id}`}
                  src={serverAddress + person.face_url}
                  alt={person.name}
                />
              ))}
            </Avatar.Group>
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
            const uniqueLocations = _.uniq(locations).map(location => <Text key={location}>{location}</Text>);
            return (
              <div key={v[0]}>
                <Divider hidden />
                <Group>
                  <Calendar />
                  <div>
                    <Title order={5}>
                      {t("autoalbumgallery.day", { day: i + 1 })} -{" "}
                      {DateTime.fromISO(v[0]).setLocale(i18nResolvedLanguage()).toLocaleString(DateTime.DATE_HUGE)}
                    </Title>
                    <Text c="dimmed">
                      <Breadcrumbs separator="/">{uniqueLocations}</Breadcrumbs>
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
                  <Box
                    key={photo.image_hash}
                    onClick={() => {
                      if (albumID) {
                        const indexOf = album.photos.map(p => p.image_hash).indexOf(photo.image_hash);
                        setLightboxOpen(true);
                        setLightboxImageIndex(indexOf);
                      }
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
                  </Box>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {lightboxOpen && albumID && (
        <LightBox
          isPublic={false}
          idx2hash={album.photos.map(i => i.image_hash)}
          lightboxImageIndex={lightboxImageIndex}
          lightboxImageId={album.photos[lightboxImageIndex].image_hash}
          onCloseRequest={() => setLightboxOpen(false)}
          onImageLoad={() => {
            getPhotoDetails(album.photos[lightboxImageIndex].image_hash);
          }}
          onMovePrevRequest={() => {
            const nextIndex = (lightboxImageIndex + album.photos.length - 1) % album.photos.length;
            setLightboxImageIndex(nextIndex);
            getPhotoDetails(album.photos[nextIndex].image_hash);
          }}
          onMoveNextRequest={() => {
            const nextIndex = (lightboxImageIndex + album.photos.length + 1) % album.photos.length;
            setLightboxImageIndex(nextIndex);
            getPhotoDetails(album.photos[nextIndex].image_hash);
          }}
        />
      )}
    </div>
  );
}
