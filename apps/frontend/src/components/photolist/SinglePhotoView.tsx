import { Box, Container, Anchor, Paper, Stack, Text, Center, Loader, Grid, Title, Group, Divider, Badge, Button, useMantineTheme, SimpleGrid } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import React from "react";
import { useParams } from "react-router-dom";
import { DateTime } from "luxon";
import { IconPhoto } from "@tabler/icons-react";

import { serverAddress } from "../../api_client/apiClient";
import { TimestampItem } from "../lightbox/TimestampItem";
import { Description } from "../lightbox/Description";
import { MediaDisplay } from "../lightbox/MediaDisplay";
import { CameraInfoComponent } from "../lightbox/CameraInfoComponent";
import type { FaceLocationType } from "../lightbox/lightbox.types";
import { FileInfoComponent } from "../lightbox/FileInfoComponent";
import { SimilarPhotosSection } from "../lightbox/SimilarPhotosSection";
import { LocationSection } from "../lightbox/LocationSection";
import { PeopleSection } from "../lightbox/PeopleSection";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks";

export function SinglePhotoView() {
  const { photoId } = useParams();
  const { data: photoDetail } = useFetchPhotoDetailsQuery(photoId || "");
  const [imageDimensions, setImageDimensions] = React.useState({ width: 0, height: 0 });
  const [faceLocation, setFaceLocation] = React.useState<FaceLocationType>(null);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

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

  const fileName = photoDetail.image_path && photoDetail.image_path.length > 0
    ? photoDetail.image_path[0].substring(photoDetail.image_path[0].lastIndexOf("/") + 1)
    : "Unknown filename";
  const fileSize = Math.round((photoDetail.size / 1024 / 1024) * 100) / 100 < 1 
    ? `${Math.round((photoDetail.size / 1024) * 100) / 100} kB` 
    : `${Math.round((photoDetail.size / 1024 / 1024) * 100) / 100} MB`;
  const dimensions = `${photoDetail.height} x ${photoDetail.width}`;
  const timestamp = photoDetail.exif_timestamp 
    ? DateTime.fromISO(photoDetail.exif_timestamp).toLocaleString(DateTime.DATETIME_MED)
    : "Unknown timestamp";

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
                <FileInfoComponent info={timestamp} size="sm" />
              </Group>
          </Stack>

          <Divider />

          {/* Media Display */}
          <Box>
            <MediaDisplay
              id={photoDetail.image_hash}
              isMainContent={true}
              type={photoDetail.video ? "video" : "photo"}
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
                  // To-Do: Implement this
                  setFaceLocation={() => {}}
                  // To-Do: Implement this
                  onPersonEdit={() => {}}
                  // To-Do: Implement this
                  notThisPerson={() => {}}
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