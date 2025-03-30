import { Box, Container, Anchor, Paper, Stack, Text, Center, Loader, Grid, Title, Group, Divider, Badge } from "@mantine/core";
import React from "react";
import { useParams } from "react-router-dom";
import { DateTime } from "luxon";
import { IconPhoto, IconFolder, IconCamera } from "@tabler/icons-react";

import { serverAddress } from "../../api_client/apiClient";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { photoDetailsApi } from "../../api_client/photos/photoDetail";
import { TimestampItem } from "../lightbox/TimestampItem";
import { Description } from "../lightbox/Description";
import { LocationMap } from "../LocationMap";
import { MediaDisplay } from "../lightbox/MediaDisplay";
import { VersionComponent } from "../lightbox/VersionComponent";
import { PersonDetail } from "../lightbox/PersonDetailComponent";
import type { FaceLocationType } from "../lightbox/lightbox.types";
import { FileInfoComponent } from "../lightbox/FileInfoComponent";

export function SinglePhotoView() {
  const { photoId } = useParams();
  const { photoDetails } = useAppSelector(store => store.photoDetails);
  const dispatch = useAppDispatch();
  const photoDetail = photoDetails[photoId || ""];
  const [imageDimensions, setImageDimensions] = React.useState({ width: 0, height: 0 });
  const [faceLocation, setFaceLocation] = React.useState<FaceLocationType>(null);

  const handleSetFaceLocation = (face: { face_id: number; face_url: string }) => {
    // For now, we'll just set a default face location since we don't have the actual coordinates
    setFaceLocation({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0
    });
  };

  const notThisPerson = (faceId: number) => {
    dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(photoId || "")).refetch();
  };

  const handlePersonEdit = (faceId: string, faceUrl: string) => {
    // Implementation would go here if needed
  };

  React.useEffect(() => {
    if (photoId) {
      dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(photoId));
    }
  }, [photoId, dispatch]);

  if (!photoId) {
    return (
      <Container fluid>
        <Center>
          <Text>No photo ID provided</Text>
        </Center>
      </Container>
    );
  }

  if (!photoDetail) {
    return (
      <Container fluid>
        <Center>
          <Stack align="center" gap="md">
            <Loader />
            <Text>Loading photo details...</Text>
          </Stack>
        </Center>
      </Container>
    );
  }

  return (
    <Container fluid>
      <Paper shadow="sm" p="md">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <Stack gap="xs" style={{ width: '100%' }}>
              <Group gap="xs">
                <IconPhoto size={45} />
                <Anchor href={`${serverAddress}/media/photos/${photoDetail.image_hash}`} target="_blank">
                  <Title fw={800} lineClamp={1}>
                    {photoDetail.image_path[0].substring(photoDetail.image_path[0].lastIndexOf("/") + 1)}
                  </Title>
                </Anchor>
              </Group>
              <Group>
                <FileInfoComponent info={`${photoDetail.height} x ${photoDetail.width}`} size="sm" />
                {Math.round((photoDetail.size / 1024 / 1024) * 100) / 100 < 1 ? (
                  <FileInfoComponent info={`${Math.round((photoDetail.size / 1024) * 100) / 100} kB`} size="sm" />
                ) : (
                  <FileInfoComponent info={`${Math.round((photoDetail.size / 1024 / 1024) * 100) / 100} MB`} size="sm" />
                )}
                <FileInfoComponent info={DateTime.fromISO(photoDetail.exif_timestamp).toLocaleString(DateTime.DATETIME_MED)} size="sm" />
              </Group>
            </Stack>
          </Group>

          <Divider />

          <MediaDisplay
            id={photoDetail.image_hash}
            isMainContent={true}
            type={photoDetail.type?.includes("video") ? "video" : "photo"}
            imageDimensions={imageDimensions}
            setImageDimensions={setImageDimensions}
            faceLocation={faceLocation}
            handleDragStart={() => {}}
          />

              <Stack gap="md">
                <TimestampItem isPublic={false} photoDetail={photoDetail} />
                <Divider />
                
                {photoDetail.people && photoDetail.people.length > 0 && (
                  <>
                    <Title order={4}>People</Title>
                    <Group>
                      {photoDetail.people.map(person => (
                        <PersonDetail
                          key={person.name}
                          person={person}
                          isPublic={false}
                          setFaceLocation={handleSetFaceLocation}
                          onPersonEdit={handlePersonEdit}
                          notThisPerson={notThisPerson}
                        />
                      ))}
                    </Group>
                    <Divider />
                  </>
                )}
                
                <VersionComponent photoDetail={photoDetail} isPublic={false} />
              </Stack>
              <Stack gap="md">
                {photoDetail.search_location && (
                  <>
                    <Title order={4}>Location</Title>
                    <Text>{photoDetail.search_location}</Text>
                    {photoDetail.exif_gps_lat && (
                      <Box h={250}>
                        <LocationMap photos={[photoDetail]} />
                      </Box>
                    )}
                    <Divider />
                  </>
                )}
                
                <Description photoDetail={photoDetail} isPublic={false} />
                
                {photoDetail.similar_photos && photoDetail.similar_photos.length > 0 && (
                  <>
                    <Divider />
                    <Title order={4}>Similar Photos</Title>
                    <Grid gutter="xs">
                      {photoDetail.similar_photos.slice(0, 8).map(el => (
                        <Grid.Col key={el.image_hash} span={3}>
                          <a href={`/photo/${el.image_hash}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                            <Box 
                              style={{
                                backgroundImage: `url(${serverAddress}/media/thumbnail/${el.image_hash})`,
                                backgroundSize: 'cover',
                                backgroundPosition: 'center',
                                width: '100%',
                                height: 80,
                                borderRadius: 4
                              }}
                            />
                          </a>
                        </Grid.Col>
                      ))}
                    </Grid>
                  </>
                )}
              </Stack>
        </Stack>
      </Paper>
    </Container>
  );
}