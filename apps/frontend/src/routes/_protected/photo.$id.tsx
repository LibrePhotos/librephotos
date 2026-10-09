import {
  Anchor,
  Box,
  Button,
  Center,
  Container,
  Divider,
  Grid,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconAlertCircle, IconPhoto } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import { useSetFacesPersonLabelMutation } from "../../api_client/faces";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks";
import { BreadcrumbPath } from "../../components/common/BreadcrumbPath";
import type { FaceLocationType } from "../../components/lightbox";
import { MediaDisplay } from "../../components/lightbox";
import { AlbumsSection } from "../../components/lightbox/AlbumsSection";
import { CameraInfoComponent } from "../../components/lightbox/CameraInfoComponent";
import { Description } from "../../components/lightbox/Description";
import { FileInfoComponent } from "../../components/lightbox/FileInfoComponent";
import { KeywordsSection } from "../../components/lightbox/KeywordsSection";
import { LocationSection } from "../../components/lightbox/LocationSection";
import { PeopleSection } from "../../components/lightbox/PeopleSection";
import { SimilarPhotosSection } from "../../components/lightbox/SimilarPhotosSection";
import { TagsSection } from "../../components/lightbox/TagsSection";
import { TimestampItem } from "../../components/lightbox/TimestampItem";
import { ModalPersonEdit } from "../../components/modals/ModalPersonEdit";
import { i18nResolvedLanguage } from "../../i18n";
import { notification } from "../../service/notifications";
import { parsePhotoTimestamp } from "../../util/dateUtils";

export const Route = createFileRoute("/_protected/photo/$id")({
  component: SinglePhotoView,
});

function SinglePhotoView() {
  const { id: photoId } = Route.useParams();
  const { t } = useTranslation();
  const { data: photoDetail, isError } = useFetchPhotoDetailsQuery(photoId || "");
  const [faceLocation, setFaceLocation] = React.useState<FaceLocationType>(null);
  // Naming a face or moving it off a person, as the lightbox's sidebar does.
  const [selectedFaces, setSelectedFaces] = React.useState<{ face_id: number; face_url: string }[]>([]);
  const { mutate: setFacesPersonLabel } = useSetFacesPersonLabelMutation();
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  if (!photoId) {
    return (
      <Container fluid>
        <Center>
          <Text>{t("photopage.noid")}</Text>
        </Center>
      </Container>
    );
  }

  // A deleted photo, someone else's, or a mistyped link: say so instead of
  // spinning forever.
  if (isError && !photoDetail) {
    return (
      <Container fluid>
        <Center py="xl">
          <Stack align="center" gap="xs">
            <IconAlertCircle size={48} />
            <Text fw={600}>{t("photopage.notfound")}</Text>
            <Button component={Link} to="/" variant="light" mt="xs">
              {t("publicalbum.goHome")}
            </Button>
          </Stack>
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
            <Text size={isMobile ? "sm" : "md"}>{t("photopage.loading")}</Text>
          </Stack>
        </Center>
      </Container>
    );
  }

  // Either separator: a library on Windows stores backslashed paths.
  const fileName =
    photoDetail.image_path && photoDetail.image_path.length > 0
      ? photoDetail.image_path[0].split(/[\\/]/).pop()
      : t("photopage.unknownfilename");
  const timestamp = photoDetail.exif_timestamp
    ? parsePhotoTimestamp(photoDetail.exif_timestamp)
        .setLocale(i18nResolvedLanguage())
        .toLocaleString(DateTime.DATETIME_MED)
    : t("lightbox.sidebar.withouttimestamp");

  const notThisPerson = (faceId: number) => {
    setFacesPersonLabel({ faceIds: [faceId], personName: "Unknown - Other" });
    notification.removeFacesFromPerson(1);
  };

  return (
    <Container fluid p={isMobile ? "xs" : "md"}>
      <Paper shadow="sm" p={isMobile ? "xs" : "md"} radius="md">
        <Stack gap={isMobile ? "xs" : "md"}>
          {/* Header Section */}
          <Stack gap="xs">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Group gap="xs" wrap="nowrap" style={{ maxWidth: "100%" }}>
                <IconPhoto size={isMobile ? 30 : 45} />
                <Anchor href={`${serverAddress}/media/photos/${photoDetail.image_hash}`} target="_blank">
                  <Title size={isMobile ? "h3" : "h2"} fw={800} lineClamp={1}>
                    {fileName}
                  </Title>
                </Anchor>
              </Group>
            </Group>

            <Group>
              <FileInfoComponent info={`${photoDetail.width} × ${photoDetail.height}`} size="sm" />
              {Math.round((photoDetail.size / 1024 / 1024) * 100) / 100 < 1 ? (
                <FileInfoComponent info={`${Math.round((photoDetail.size / 1024) * 100) / 100} kB`} size="sm" />
              ) : (
                <FileInfoComponent info={`${Math.round((photoDetail.size / 1024 / 1024) * 100) / 100} MB`} size="sm" />
              )}
              <FileInfoComponent info={timestamp} size="sm" />
              {photoDetail.image_path && photoDetail.image_path.length > 0 && (
                <BreadcrumbPath
                  fullPath={photoDetail.image_path[0].replace(/\\/g, "/").split("/").slice(0, -1).join("/")}
                  size="sm"
                />
              )}
            </Group>
          </Stack>

          <Divider />

          {/* Media Display */}
          <Box>
            <MediaDisplay
              id={photoDetail.image_hash}
              isMainContent={true}
              type={photoDetail.video ? "video" : "photo"}
              faceLocation={faceLocation}
              handleDragStart={() => {}}
              fullHeight={true}
              photoDetails={photoDetail}
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
                  // Called with the face's location box, whatever the prop type says.
                  setFaceLocation={location => setFaceLocation(location as unknown as FaceLocationType)}
                  onPersonEdit={(faceId, faceUrl) =>
                    setSelectedFaces([{ face_id: parseInt(faceId, 10), face_url: faceUrl }])
                  }
                  notThisPerson={notThisPerson}
                />
                <Description photoDetail={photoDetail} isPublic={false} />
                <TagsSection photoDetail={photoDetail} />
                <KeywordsSection photoDetail={photoDetail} />
              </Stack>
            </Grid.Col>

            {/* Right Column - Secondary Information */}
            <Grid.Col span={isMobile ? 12 : 6}>
              <Stack gap={isMobile ? "xs" : "md"}>
                <CameraInfoComponent photoDetail={photoDetail} />
                <LocationSection photoDetail={photoDetail} />
                <AlbumsSection imageHash={photoDetail.image_hash} />
              </Stack>
            </Grid.Col>
          </Grid>
          <SimilarPhotosSection photoDetail={photoDetail} />
        </Stack>
      </Paper>
      <ModalPersonEdit
        isOpen={selectedFaces.length > 0}
        onRequestClose={() => setSelectedFaces([])}
        selectedFaces={selectedFaces}
      />
    </Container>
  );
}
