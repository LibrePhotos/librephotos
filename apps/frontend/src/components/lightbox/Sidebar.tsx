import {
  ActionIcon,
  Box,
  Group,
  Loader,
  Stack,
  Text,
  Title,
  Tooltip,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { IconX as X } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetFacesPersonLabelMutation } from "../../api_client/faces";
import { useFetchPhotoDetailsQuery, useFetchPublicPhotoDetailQuery } from "../../api_client/photos/hooks";
import { notification } from "../../service/notifications";
import { ModalPersonEdit } from "../modals/ModalPersonEdit";
import { AlbumsSection } from "./AlbumsSection";
import { CategorySection } from "./CategorySection";
import { Description } from "./Description";
import { KeywordsSection } from "./KeywordsSection";
import type { FaceLocationType, LightboxItem } from "./lightbox.types";
import { LocationSection } from "./LocationSection";
import { PeopleSection } from "./PeopleSection";
import { SimilarPhotosSection } from "./SimilarPhotosSection";
import { StackSection } from "./StackSection";
import { TagsSection } from "./TagsSection";
import { TimestampItem } from "./TimestampItem";
import { CameraInfoSection, VersionComponent } from "./VersionComponent";

interface SidebarProps {
  isPublic: boolean;
  publicAlbumSlug?: string;
  id: string;
  /** The grid's entry for the photo, all a viewer who is not the owner has of it. */
  gridItem?: LightboxItem;
  closeSidepanel: () => void;
  /** The box of the face the pointer is on, or null once it leaves. */
  setFaceLocation: (location: FaceLocationType) => void;
  onPhotoSelect?: (photoId: string) => void;
  /** Marking a face the detector missed happens on the photo, which the viewer owns. */
  onAddFaceRequest?: () => void;
  onCancelAddFace?: () => void;
  isDrawingFace?: boolean;
  addFaceBlockedReason?: string;
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

/** The panel every state of the sidebar renders in. */
function SidebarPanel({ children }: { children: React.ReactNode }) {
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();

  // Apply shadow only on mobile
  const shadowStyle = {
    ...sidebarStyles.container,
    boxShadow: window.innerWidth < 768 ? sidebarStyles.container.boxShadow : "none",
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
      {children}
    </Box>
  );
}

type SidebarHeaderProps = {
  closeSidepanel: () => void;
};

function SidebarHeader({ closeSidepanel }: SidebarHeaderProps) {
  const { t } = useTranslation();
  return (
    <Group justify="space-between">
      <Title order={3}>{t("lightbox.sidebar.details")}</Title>
      <Tooltip label={t("lightbox.toolbar.hideInfoPanel")}>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={t("lightbox.toolbar.hideInfoPanel")}
          onClick={closeSidepanel}
        >
          <X />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

export function Sidebar({
  isPublic,
  publicAlbumSlug,
  closeSidepanel,
  setFaceLocation,
  id,
  gridItem,
  onPhotoSelect,
  onAddFaceRequest,
  onCancelAddFace,
  isDrawingFace,
  addFaceBlockedReason,
}: SidebarProps) {
  const { t } = useTranslation();
  const [personEditOpen, setPersonEditOpen] = useState(false);
  const [selectedFaces, setSelectedFaces] = useState<SelectedFace[]>([]);

  // Skip photo details query on public pages - use public API instead
  const { data: photoDetail, isError: isPhotoDetailError } = useFetchPhotoDetailsQuery(id, isPublic);

  // For public album pages with a slug, fetch public photo details
  const { data: publicPhotoData, isLoading: isPublicPhotoLoading } = useFetchPublicPhotoDetailQuery({
    slug: publicAlbumSlug || "",
    photoId: id,
    enabled: isPublic && !!publicAlbumSlug,
  });

  const { mutate: setFacesPersonLabel } = useSetFacesPersonLabelMutation();

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
      <SidebarPanel>
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
              {sharingSettings?.share_captions && <Description photoDetail={publicPhotoDetail} isPublic />}
              {sharingSettings?.share_faces && publicPhotoDetail.people.length > 0 && (
                <PeopleSection
                  photoDetail={publicPhotoDetail}
                  isPublic
                  setFaceLocation={() => {}}
                  onPersonEdit={() => {}}
                  notThisPerson={() => {}}
                />
              )}
              {!hasAnySharedContent && (
                <Text size="sm" c="dimmed">
                  {t("lightbox.sidebar.noAdditionalDetails")}
                </Text>
              )}
            </>
          )}
          {!isPublicPhotoLoading && !publicPhotoDetail && (
            <Text size="sm" c="dimmed">
              {t("lightbox.sidebar.detailsLoadFailed")}
            </Text>
          )}
        </Stack>
      </SidebarPanel>
    );
  }

  // Public pages without a slug, and shared albums: anyone who is not the owner.
  if (isPublic) {
    // The grid already shows these viewers the date and place (the server
    // leaves out what it may not share), so the panel does too.
    const date = gridItem?.date || null;
    const location = gridItem?.location || null;
    return (
      <SidebarPanel>
        <Stack>
          <SidebarHeader closeSidepanel={closeSidepanel} />
          {date && <TimestampItem photoDetail={{ image_hash: id, exif_timestamp: date }} isPublic />}
          {/* The grid has the place name, never the coordinates: no map. */}
          {location && (
            <LocationSection
              photoDetail={{ image_hash: id, search_location: location, exif_gps_lat: null, exif_gps_lon: null }}
              isPublic
            />
          )}
          <Text size="sm" c="dimmed">
            {date || location ? t("lightbox.sidebar.ownerOnlyMoreDetails") : t("lightbox.sidebar.ownerOnlyDetails")}
          </Text>
        </Stack>
      </SidebarPanel>
    );
  }

  if (!photoDetail) {
    // Keep the panel in place while loading, and say so if the photo has no
    // details for this user, instead of an empty strip next to the photo.
    return (
      <SidebarPanel>
        <Stack>
          <SidebarHeader closeSidepanel={closeSidepanel} />
          {isPhotoDetailError ? (
            <Text size="sm" c="dimmed">
              {t("lightbox.sidebar.detailsLoadFailed")}
            </Text>
          ) : (
            <Loader size="sm" />
          )}
        </Stack>
      </SidebarPanel>
    );
  }

  const notThisPerson = (faceId: number) => {
    const ids = [faceId];
    setFacesPersonLabel({ faceIds: ids, personName: "Unknown - Other" });
    notification.removeFacesFromPerson(ids.length);
  };

  const handlePersonEdit = (faceId: number, faceUrl: string) => {
    setSelectedFaces([{ face_id: faceId, face_url: faceUrl }]);
    setPersonEditOpen(true);
  };

  const handleModalClose = () => {
    setPersonEditOpen(false);
    setSelectedFaces([]);
  };

  return (
    <SidebarPanel>
      <Stack>
        <SidebarHeader closeSidepanel={closeSidepanel} />
        <TimestampItem photoDetail={photoDetail} isPublic={isPublic} />
        <VersionComponent photoDetail={photoDetail} isPublic={isPublic} />
        {/* Owner-only: CategorySection renders nothing on someone else's photo. */}
        {!isPublic && <CategorySection key={photoDetail.image_hash} photoDetail={photoDetail} />}
        <StackSection photoDetail={photoDetail} onPhotoSelect={onPhotoSelect} />
        <LocationSection photoDetail={photoDetail} mapHeight={200} isPublic={isPublic} />
        <PeopleSection
          photoDetail={photoDetail}
          isPublic={isPublic}
          setFaceLocation={setFaceLocation}
          onPersonEdit={handlePersonEdit}
          notThisPerson={notThisPerson}
          onAddFaceRequest={onAddFaceRequest}
          onCancelAddFace={onCancelAddFace}
          isDrawingFace={isDrawingFace}
          addFaceBlockedReason={addFaceBlockedReason}
        />
        <Description photoDetail={photoDetail} isPublic={isPublic} />
        {/* Tags and keywords stay owner-only: public shares have no flag for them. */}
        {!isPublic && <TagsSection photoDetail={photoDetail} />}
        {!isPublic && <KeywordsSection photoDetail={photoDetail} />}
        {!isPublic && <AlbumsSection imageHash={photoDetail.image_hash} />}
        <SimilarPhotosSection photoDetail={photoDetail} maxItems={30} />
      </Stack>

      <ModalPersonEdit isOpen={personEditOpen} onRequestClose={handleModalClose} selectedFaces={selectedFaces} />
    </SidebarPanel>
  );
}
