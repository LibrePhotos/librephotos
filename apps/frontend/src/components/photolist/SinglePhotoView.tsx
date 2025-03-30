import { Box, Container, Anchor, Paper, Stack, Text, Center, Loader, Grid, Title, Group, Divider, Badge, Button, useMantineTheme, SimpleGrid } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import React from "react";
import { useParams } from "react-router-dom";
import { DateTime } from "luxon";
import { IconPhoto, IconFolder, IconCamera, IconMaximize, IconMinimize } from "@tabler/icons-react";

import { serverAddress } from "../../api_client/apiClient";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { photoDetailsApi } from "../../api_client/photos/photoDetail";
import { TimestampItem } from "../lightbox/TimestampItem";
import { Description } from "../lightbox/Description";
import { LocationMap } from "../LocationMap";
import { MediaDisplay } from "../lightbox/MediaDisplay";
import { CameraInfoComponent } from "../lightbox/CameraInfoComponent";
import { PersonDetail } from "../lightbox/PersonDetailComponent";
import type { FaceLocationType } from "../lightbox/lightbox.types";
import { FileInfoComponent } from "../lightbox/FileInfoComponent";
import { SimilarPhotosSection } from "../lightbox/SimilarPhotosSection";
import { LocationSection } from "../lightbox/LocationSection";
import { PeopleSection } from "../lightbox/PeopleSection";

export function SinglePhotoView() {
  const { photoId } = useParams();
  const { photoDetails } = useAppSelector(store => store.photoDetails);
  const dispatch = useAppDispatch();
  const photoDetail = photoDetails[photoId || ""];
  const [imageDimensions, setImageDimensions] = React.useState({ width: 0, height: 0 });
  const [faceLocation, setFaceLocation] = React.useState<FaceLocationType>(null);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

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
        <Center py="xl">
          <Stack align="center" gap="md">
            <Loader size={isMobile ? "md" : "lg"} />
            <Text size={isMobile ? "sm" : "md"}>Loading photo details...</Text>
          </Stack>
        </Center>
      </Container>
    );
  }

  const fileName = photoDetail.image_path[0].substring(photoDetail.image_path[0].lastIndexOf("/") + 1);
  const fileSize = Math.round((photoDetail.size / 1024 / 1024) * 100) / 100 < 1 
    ? `${Math.round((photoDetail.size / 1024) * 100) / 100} kB` 
    : `${Math.round((photoDetail.size / 1024 / 1024) * 100) / 100} MB`;
  const dimensions = `${photoDetail.height} x ${photoDetail.width}`;
  const timestamp = DateTime.fromISO(photoDetail.exif_timestamp).toLocaleString(DateTime.DATETIME_MED);

  return (
    <Container fluid p={isMobile ? "xs" : "md"}>
      <Paper shadow="sm" p={isMobile ? "xs" : "md"} radius="md">
        <Stack gap={isMobile ? "xs" : "md"}>
          {/* Header Section */}
          <Stack gap="xs">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Group gap="xs" wrap="nowrap" style={{ maxWidth: '100%' }}>
                <IconPhoto size={isMobile ? 30 : 45} />
                <Anchor href={`${serverAddress}/media/photos/${photoDetail.image_hash}`} target="_blank">
                  <Title size={isMobile ? "h3" : "h2"} fw={800} lineClamp={1}>
                    {fileName}
                  </Title>
                </Anchor>
              </Group>
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

          <Divider />

          {/* Media Display */}
          <Box>
            <MediaDisplay
              id={photoDetail.image_hash}
              isMainContent={true}
              type={photoDetail.type?.includes("video") ? "video" : "photo"}
              imageDimensions={imageDimensions}
              setImageDimensions={setImageDimensions}
              faceLocation={faceLocation}
              handleDragStart={() => {}}
              fullHeight={true}
            />
          </Box>

          {/* Details Section */}
          <Grid gutter={isMobile ? "xs" : "md"}>
            {/* Left Column - Main Information */}
            <Grid.Col span={isMobile ? 12 : 6}>
              <Stack gap={isMobile ? "xs" : "md"}>
                <TimestampItem isPublic={false} photoDetail={photoDetail} />
                <PeopleSection 
                  photoDetail={photoDetail}
                  isPublic={false}
                  setFaceLocation={handleSetFaceLocation}
                  onPersonEdit={handlePersonEdit}
                  notThisPerson={notThisPerson}
                />
                <Description photoDetail={photoDetail} isPublic={false} />
              </Stack>
            </Grid.Col>
            
            {/* Right Column - Secondary Information */}
            <Grid.Col span={isMobile ? 12 : 6}>
              <Stack gap={isMobile ? "xs" : "md"}>
                <CameraInfoComponent photoDetail={photoDetail} />
                <LocationSection photoDetail={photoDetail} />
              </Stack>
            </Grid.Col>
          </Grid>
          <SimilarPhotosSection photoDetail={photoDetail} />
        </Stack>
      </Paper>
    </Container>
  );
}