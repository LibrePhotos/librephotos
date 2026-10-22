import type { PublicPhotoDetail, PublicPhotoDetailResponse } from "@librephotos/api-client";
import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
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
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { IconX as X } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetFacesPersonLabelMutation } from "../../api_client/faces";
import { useFetchPhotoDetailsQuery, useFetchPublicPhotoDetailQuery } from "../../api_client/photos/hooks";
import { ModalPersonEdit } from "../modals/ModalPersonEdit";
import { AlbumsSection } from "./AlbumsSection";
import { CameraInfoSection } from "./CameraInfoSection";
import { CategoryBadge } from "./CategoryBadge";
import { Description } from "./Description";
import type { FaceLocationType, LightboxItem } from "./lightbox.types";
import { LocationSection } from "./LocationSection";
import { PeopleSection } from "./PeopleSection";
import { SharedPhotoDetails } from "./SharedPhotoDetails";
import { SimilarPhotosSection } from "./SimilarPhotosSection";
import { StackSection } from "./StackSection";
import { TagsSection } from "./TagsSection";
import { TimestampItem } from "./TimestampItem";
import { TrashedItem } from "./TrashedItem";
import type { FaceDrawing } from "./useFaceDrawing";
import { VersionComponent } from "./VersionComponent";
import { WhyThisDate } from "./WhyThisDate";

type SidebarProps = {
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
  /** The viewer's face drawing: under way, cancelled here, and what became of the box (#1117). */
  faceDrawing?: Pick<FaceDrawing, "isDrawing" | "cancel" | "result">;
  addFaceBlockedReason?: string;
};

type SelectedFace = {
  face_id: number;
  face_url: string;
};

const sidebarStyles = {
  container: {
    whiteSpace: "normal" as const,
    zIndex: 250,
    overflowY: "auto" as const,
    overflowX: "hidden" as const,
    boxShadow: "0 -4px 8px var(--app-scrim-black-10)",
  },
};

/** The panel every state of the sidebar renders in. */
function SidebarPanel({ children }: { children: React.ReactNode }) {
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();
  // Below md the panel is a fixed overlay on the photo and needs the shadow. md is the
  // same breakpoint the width and position styles below switch on.
  const isSideBySide = useMediaQuery(`(min-width: ${theme.breakpoints.md})`, undefined, {
    getInitialValueInEffect: false,
  });
  const shadowStyle = {
    ...sidebarStyles.container,
    boxShadow: isSideBySide ? "none" : sidebarStyles.container.boxShadow,
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

/** A public album's photo in the shape the shared section components take. */
function toSectionPhoto(publicPhoto: PublicPhotoDetail) {
  return {
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
  };
}

type PublicAlbumSidebarProps = {
  slug: string;
  id: string;
  closeSidepanel: () => void;
};

/** The sections a public album's sharing settings switch on. */
function SharedSections({
  photo,
  sharing,
}: {
  photo: ReturnType<typeof toSectionPhoto>;
  sharing: PublicPhotoDetailResponse["sharing_settings"];
}) {
  const { t } = useTranslation();
  const sharesAnything =
    sharing.share_timestamps ||
    sharing.share_location ||
    sharing.share_camera_info ||
    sharing.share_captions ||
    sharing.share_faces;

  return (
    <>
      {sharing.share_timestamps && <TimestampItem photoDetail={photo} isPublic />}
      {sharing.share_location && <LocationSection photoDetail={photo} mapHeight={200} isPublic />}
      {sharing.share_camera_info && photo.camera && <CameraInfoSection photoDetail={photo} />}
      {sharing.share_captions && <Description photoDetail={photo} isPublic />}
      {sharing.share_faces && photo.people.length > 0 && (
        <PeopleSection
          photoDetail={photo}
          isPublic
          setFaceLocation={() => {}}
          onPersonEdit={() => {}}
          notThisPerson={() => {}}
        />
      )}
      {!sharesAnything && (
        <Text size="sm" c="dimmed">
          {t("lightbox.sidebar.noAdditionalDetails")}
        </Text>
      )}
    </>
  );
}

/** A public album page: what the album's sharing settings let a visitor see. */
function PublicAlbumSidebar({ slug, id, closeSidepanel }: PublicAlbumSidebarProps) {
  const { t } = useTranslation();
  const { data: publicPhotoData, isLoading } = useFetchPublicPhotoDetailQuery({ slug, photoId: id });

  return (
    <SidebarPanel>
      <Stack>
        <SidebarHeader closeSidepanel={closeSidepanel} />
        {isLoading && <Loader size="sm" />}
        {!isLoading && publicPhotoData && (
          <SharedSections photo={toSectionPhoto(publicPhotoData.results)} sharing={publicPhotoData.sharing_settings} />
        )}
        {!isLoading && !publicPhotoData && (
          <Text size="sm" c="dimmed">
            {t("lightbox.sidebar.detailsLoadFailed")}
          </Text>
        )}
      </Stack>
    </SidebarPanel>
  );
}

type SharedViewerSidebarProps = {
  id: string;
  gridItem?: LightboxItem;
  closeSidepanel: () => void;
  setFaceLocation: (location: FaceLocationType) => void;
};

/** Public pages without a slug, and shared albums: anyone who is not the owner. */
function SharedViewerSidebar({ id, gridItem, closeSidepanel, setFaceLocation }: SharedViewerSidebarProps) {
  const { t } = useTranslation();
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
        <SharedPhotoDetails id={id} setFaceLocation={setFaceLocation} />
        <Text size="sm" c="dimmed">
          {date || location ? t("lightbox.sidebar.ownerOnlyMoreDetails") : t("lightbox.sidebar.ownerOnlyDetails")}
        </Text>
      </Stack>
    </SidebarPanel>
  );
}

export function Sidebar({ isPublic, publicAlbumSlug, ...props }: SidebarProps) {
  if (isPublic && publicAlbumSlug) {
    return <PublicAlbumSidebar slug={publicAlbumSlug} id={props.id} closeSidepanel={props.closeSidepanel} />;
  }
  if (isPublic) {
    return (
      <SharedViewerSidebar
        id={props.id}
        gridItem={props.gridItem}
        closeSidepanel={props.closeSidepanel}
        setFaceLocation={props.setFaceLocation}
      />
    );
  }
  return <OwnerSidebar {...props} />;
}

/** The owner's own photo: every section, editable. */
function OwnerSidebar({
  closeSidepanel,
  setFaceLocation,
  id,
  onPhotoSelect,
  onAddFaceRequest,
  faceDrawing,
  addFaceBlockedReason,
}: Omit<SidebarProps, "isPublic" | "publicAlbumSlug">) {
  const { t } = useTranslation();
  const [personEditOpen, { open: openPersonEdit, close: closePersonEdit }] = useDisclosure(false);
  const [selectedFaces, setSelectedFaces] = useState<SelectedFace[]>([]);

  const { data: photoDetail, isError: isPhotoDetailError } = useFetchPhotoDetailsQuery(id);
  const { mutate: setFacesPersonLabel } = useSetFacesPersonLabelMutation();

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
    // The hook says so once the server confirmed
    setFacesPersonLabel({ faceIds: ids, personName: UNKNOWN_PERSON_NAME });
  };

  const handlePersonEdit = (faceId: number, faceUrl: string) => {
    setSelectedFaces([{ face_id: faceId, face_url: faceUrl }]);
    openPersonEdit();
  };

  const handleModalClose = () => {
    closePersonEdit();
    setSelectedFaces([]);
  };

  return (
    <SidebarPanel>
      <Stack>
        <SidebarHeader closeSidepanel={closeSidepanel} />
        <TimestampItem photoDetail={photoDetail} isPublic={false} extra={<WhyThisDate photo={photoDetail} />} />
        {photoDetail.in_trashcan && <TrashedItem trashedAt={photoDetail.trashed_at} />}
        <VersionComponent
          photoDetail={photoDetail}
          isPublic={false}
          category={<CategoryBadge key={photoDetail.image_hash} photoDetail={photoDetail} />}
        />
        <StackSection photoDetail={photoDetail} onPhotoSelect={onPhotoSelect} />
        <LocationSection photoDetail={photoDetail} mapHeight={200} isPublic={false} />
        <PeopleSection
          photoDetail={photoDetail}
          isPublic={false}
          setFaceLocation={setFaceLocation}
          onPersonEdit={handlePersonEdit}
          notThisPerson={notThisPerson}
          onAddFaceRequest={onAddFaceRequest}
          onCancelAddFace={faceDrawing?.cancel}
          isDrawingFace={faceDrawing?.isDrawing}
          drawResult={faceDrawing?.result}
          addFaceBlockedReason={addFaceBlockedReason}
        />
        <Description photoDetail={photoDetail} isPublic={false} />
        {/* Tags stay owner-only: public shares have no flag for them. The file's
            keywords are tags too (a scan makes one of each), marked as such. */}
        <TagsSection photoDetail={photoDetail} />
        <AlbumsSection imageHash={photoDetail.image_hash} />
        <SimilarPhotosSection photoDetail={photoDetail} maxItems={30} />
      </Stack>

      <ModalPersonEdit isOpen={personEditOpen} onRequestClose={handleModalClose} selectedFaces={selectedFaces} />
    </SidebarPanel>
  );
}
