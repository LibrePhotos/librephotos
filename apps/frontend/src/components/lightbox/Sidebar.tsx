import {
  ActionIcon,
  Box,
  Group,
  Loader,
  Stack,
  Text,
  Title,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { IconX as X } from "@tabler/icons-react";
import React, { useState } from "react";
import "react-virtualized/styles.css";
import { useSetFacesPersonLabelMutation } from "../../api_client/faces";
import { useFetchPhotoDetailsQuery, useFetchPublicPhotoDetailQuery } from "../../api_client/photos/hooks";
import { notification } from "../../service/notifications";
import { ModalPersonEdit } from "../modals/ModalPersonEdit";
import { AlbumsSection } from "./AlbumsSection";
import { Description } from "./Description";
import { LocationSection } from "./LocationSection";
import { PeopleSection } from "./PeopleSection";
import { SimilarPhotosSection } from "./SimilarPhotosSection";
import { StackSection } from "./StackSection";
import { TimestampItem } from "./TimestampItem";
import { CameraInfoSection, VersionComponent } from "./VersionComponent";

interface SidebarProps {
  isPublic: boolean;
  publicAlbumSlug?: string;
  id: string;
  closeSidepanel: () => void;
  setFaceLocation: (face: { face_id: number; face_url: string }) => void;
  onPhotoSelect?: (photoId: string) => void;
}

interface SelectedFace {
  face_id: number;
  face_url: string;
}

const sidebarStyles = {
  container: {
    whiteSpace: "normal" as const,
    zIndex: 250,
    overflowY: "auto" as const,
    overflowX: "hidden" as const,
    boxShadow: "0 -4px 8px rgba(0,0,0,0.1)",
  },
};

type SidebarHeaderProps = {
  closeSidepanel: () => void;
};

function SidebarHeader({ closeSidepanel }: SidebarHeaderProps) {
  return (
    <Group justify="space-between">
      <Title order={3}>Details</Title>
      <ActionIcon variant="subtle" color="gray" onClick={closeSidepanel}>
        <X />
      </ActionIcon>
    </Group>
  );
}

export function Sidebar({
  isPublic,
  publicAlbumSlug,
  closeSidepanel,
  setFaceLocation,
  id,
  onPhotoSelect,
}: SidebarProps) {
  const [personEditOpen, setPersonEditOpen] = useState(false);
  const [selectedFaces, setSelectedFaces] = useState<SelectedFace[]>([]);

  // Skip photo details query on public pages - use public API instead
  const { data: photoDetail } = useFetchPhotoDetailsQuery(id, isPublic);

  // For public album pages with a slug, fetch public photo details
  const { data: publicPhotoData, isLoading: isPublicPhotoLoading } = useFetchPublicPhotoDetailQuery({
    slug: publicAlbumSlug || "",
    photoId: id,
    enabled: isPublic && !!publicAlbumSlug,
  });

  const { mutate: setFacesPersonLabel } = useSetFacesPersonLabelMutation();

  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();

  // Apply shadow only on mobile
  const shadowStyle = {
    ...sidebarStyles.container,
    boxShadow: window.innerWidth < 768 ? sidebarStyles.container.boxShadow : "none",
  };

  // On public pages with a slug, show available photo details based on sharing settings
  if (isPublic && publicAlbumSlug) {
    const sharingSettings = publicPhotoData?.sharing_settings;
    const publicPhoto = publicPhotoData?.results;

    // Convert public photo data to a Photo-like object for reusing components
    const publicPhotoDetail = publicPhoto
      ? {
          image_hash: publicPhoto.image_hash,
          video: publicPhoto.video,
          exif_timestamp: publicPhoto.exif_timestamp ?? null,
          exif_gps_lat: publicPhoto.exif_gps_lat ?? null,
          exif_gps_lon: publicPhoto.exif_gps_lon ?? null,
          search_location: publicPhoto.search_location ?? null,
          geolocation_json: publicPhoto.geolocation_json ?? null,
          camera: publicPhoto.camera ?? null,
          lens: publicPhoto.lens ?? null,
          fstop: publicPhoto.fstop ?? null,
          shutter_speed: publicPhoto.shutter_speed ?? null,
          iso: publicPhoto.iso ?? null,
          focal_length: publicPhoto.focal_length ?? null,
          width: publicPhoto.width ?? null,
          height: publicPhoto.height ?? null,
          search_captions: publicPhoto.search_captions ?? null,
          captions_json: publicPhoto.captions_json ?? null,
          people:
            publicPhoto.people?.map(p => ({
              name: p.name,
              face_url: p.face_url ?? "",
              face_id: p.face_id,
              type: "person",
              probability: 1,
              location: { top: 0, bottom: 0, left: 0, right: 0 },
            })) ?? [],
        }
      : null;

    const hasAnySharedContent =
      sharingSettings?.share_timestamps ||
      sharingSettings?.share_location ||
      sharingSettings?.share_camera_info ||
      sharingSettings?.share_captions ||
      sharingSettings?.share_faces;

    return (
      <Box
        w={{ base: "100%", md: "400px" }}
        h="100%"
        pos={{ base: "fixed", md: "relative" }}
        top={{ base: 0, md: "auto" }}
        right={{ base: 0, md: "auto" }}
        bottom={{ base: 0, md: "auto" }}
        style={shadowStyle}
        p="sm"
        bg={colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[0]}
      >
        <Stack>
          <SidebarHeader closeSidepanel={closeSidepanel} />
          {isPublicPhotoLoading && <Loader size="sm" />}
          {!isPublicPhotoLoading && publicPhotoDetail && (
            <>
              {sharingSettings?.share_timestamps && <TimestampItem photoDetail={publicPhotoDetail} isPublic />}
              {sharingSettings?.share_location && (
                <LocationSection photoDetail={publicPhotoDetail} mapHeight={200} isPublic />
              )}
              {sharingSettings?.share_camera_info && publicPhotoDetail.camera && (
                <CameraInfoSection photoDetail={publicPhotoDetail} />
              )}
              {sharingSettings?.share_captions && <Description photoDetail={publicPhotoDetail as any} isPublic />}
              {sharingSettings?.share_faces && publicPhotoDetail.people.length > 0 && (
                <PeopleSection
                  photoDetail={publicPhotoDetail as any}
                  isPublic
                  setFaceLocation={() => {}}
                  onPersonEdit={() => {}}
                  notThisPerson={() => {}}
                />
              )}
              {!hasAnySharedContent && (
                <Text size="sm" c="dimmed">
                  No additional details available for this photo.
                </Text>
              )}
            </>
          )}
          {!isPublicPhotoLoading && !publicPhotoDetail && (
            <Text size="sm" c="dimmed">
              Photo details could not be loaded.
            </Text>
          )}
        </Stack>
      </Box>
    );
  }

  // On public pages without a slug (legacy public photos), show simple message
  if (isPublic) {
    return (
      <Box
        w={{ base: "100%", md: "400px" }}
        h="100%"
        pos={{ base: "fixed", md: "relative" }}
        top={{ base: 0, md: "auto" }}
        right={{ base: 0, md: "auto" }}
        bottom={{ base: 0, md: "auto" }}
        style={shadowStyle}
        p="sm"
        bg={colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[0]}
      >
        <Stack>
          <SidebarHeader closeSidepanel={closeSidepanel} />
          <Title order={5} c="dimmed">
            Photo details are not available for public albums
          </Title>
        </Stack>
      </Box>
    );
  }

  if (!photoDetail) {
    return null;
  }

  const notThisPerson = (faceId: number) => {
    const ids = [faceId];
    setFacesPersonLabel({ faceIds: ids, personName: "Unknown - Other" });
    notification.removeFacesFromPerson(ids.length);
  };

  const handlePersonEdit = (faceId: string, faceUrl: string) => {
    setSelectedFaces([{ face_id: parseInt(faceId, 10), face_url: faceUrl }]);
    setPersonEditOpen(true);
  };

  const handleModalClose = () => {
    setPersonEditOpen(false);
    setSelectedFaces([]);
  };

  return (
    <Box
      w={{ base: "100%", md: "400px" }}
      h="100%"
      pos={{ base: "fixed", md: "relative" }}
      top={{ base: 0, md: "auto" }}
      right={{ base: 0, md: "auto" }}
      bottom={{ base: 0, md: "auto" }}
      style={shadowStyle}
      p="sm"
      bg={colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[0]}
    >
      <Stack>
        <SidebarHeader closeSidepanel={closeSidepanel} />
        <TimestampItem photoDetail={photoDetail} isPublic={isPublic} />
        <VersionComponent photoDetail={photoDetail} isPublic={isPublic} />
        <StackSection photoDetail={photoDetail} onPhotoSelect={onPhotoSelect} />
        <LocationSection photoDetail={photoDetail} mapHeight={200} isPublic={isPublic} />
        <PeopleSection
          photoDetail={photoDetail}
          isPublic={isPublic}
          setFaceLocation={setFaceLocation}
          onPersonEdit={handlePersonEdit}
          notThisPerson={notThisPerson}
        />
        <Description photoDetail={photoDetail} isPublic={isPublic} />
        {!isPublic && <AlbumsSection imageHash={photoDetail.image_hash} />}
        <SimilarPhotosSection photoDetail={photoDetail} maxItems={30} />
      </Stack>

      <ModalPersonEdit isOpen={personEditOpen} onRequestClose={handleModalClose} selectedFaces={selectedFaces} />
    </Box>
  );
}
