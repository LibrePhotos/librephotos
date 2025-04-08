import { Avatar, Box,  Button, Divider, Group, Loader, Paper, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconMap2 as Map2,
  IconSettingsAutomation as SettingsAutomation,
} from "@tabler/icons-react";
import _ from "lodash";
import React from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { useFetchAutoAlbumQuery } from "../../api_client/tanstack-api";
import { serverAddress } from "../../api_client/apiClient";
import { AlbumLocationMap } from "../../components/AlbumLocationMap";
import { PhotoListView } from "../../components/photolist/PhotoListView";

export function AlbumAutoGalleryView() {
  const { albumID } = useParams();
  const { data: album, isFetching } = useFetchAutoAlbumQuery(albumID ?? ''); // Add null check
  const [showMap, { toggle: toggleMap }] = useDisclosure(false);
  const { t } = useTranslation();

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

  // Check if any photos have GPS coordinates
  const hasGPSCoordinates = photos.some(photo => photo.exif_gps_lat !== null && photo.exif_gps_lon !== null);

  // Convert photos to the format expected by PhotoListView
  const groupedPhotos = Object.entries(byDate).map(([date, items]) => ({
    date,
    items: items.map(photo => ({
      id: photo.image_hash,
      hash: photo.image_hash,
      video: photo.video,
      timestamp: photo.exif_timestamp,
      image_hash: photo.image_hash,
      exif_timestamp: photo.exif_timestamp,
      rating: photo.rating,
      public: photo.public,
      geolocation_json: photo.geolocation_json,
      url: photo.image_hash, // Just pass the image_hash, getUrl will construct the full URL
      type: photo.video ? "video/mp4" : "image/jpeg",
      aspectRatio: 1,
      dominantColor: "#f0f0f0",
      style: {
        width: 200,
        height: 200,
        translateX: 0,
        translateY: 0,
      },
    })),
  }));

  // Get all unique locations across all dates
  const allLocations = _.flatMap(_.toPairs(byDate), ([_, datePhotos]) => 
    datePhotos
      .filter(photo => !!photo.geolocation_json.features)
      .map(photo => {
        if (photo.geolocation_json.features) {
          return photo.geolocation_json.features[photo.geolocation_json.features.length - 3].text;
        }
        return "";
      })
  );
  const uniqueLocations = _.uniq(allLocations).map(location => <Text key={location}>{location}</Text>);

  return (
    <div>
      {(album.people.length > 0 || uniqueLocations.length > 0) && (
        <Paper shadow="sm" p="md" mb="md">
          <Group align="center" wrap="nowrap">
            {album.people.length > 0 && (
              <Avatar.Group>
                {album.people.slice(0, 5).map(person => (
                  <Avatar
                    key={person.id}
                    radius="xl"
                    component="a"
                    href={`/person/${person.id}`}
                    src={serverAddress + person.face_url}
                    alt={person.name}
                    size="sm"
                  />
                ))}
              </Avatar.Group>
            )}

            {uniqueLocations.length > 0 && (
              <>
                {album.people.length > 0 && <Divider orientation="vertical" />}
                {hasGPSCoordinates && (
                  <Button 
                    variant={showMap ? "filled" : "light"} 
                    color={showMap ? "blue" : "gray"} 
                    onClick={toggleMap} 
                    leftSection={<Map2 size={16} />}
                    size="xs"
                  >
                    {showMap ? t("autoalbumgallery.hidemap") : `${uniqueLocations[0].props.children} on map`}
                  </Button>
                )}
              </>
            )}
          </Group>

          {showMap && hasGPSCoordinates && (
            <Box mt="md">
              <AlbumLocationMap photos={photos} />
            </Box>
          )}
        </Paper>
      )}

      <PhotoListView
        title={album.title}
        loading={isFetching}
        icon={<SettingsAutomation size={50} />}
        photoset={groupedPhotos}
        idx2hash={photos.map(photo => ({ id: photo.image_hash }))}
        selectable
      />
    </div>
  );
}
