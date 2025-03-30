import { ActionIcon, Box, Group, Stack, Text, Title, useComputedColorScheme, useMantineTheme, Grid, Anchor } from "@mantine/core";
import { IconMap2 as Map2, IconPhoto as Photo, IconX as X } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import "react-virtualized/styles.css";

import type { Photo as PhotoType } from "../../actions/photosActions.types";
import { api } from "../../api_client/api";
import { photoDetailsApi } from "../../api_client/photos/photoDetail";
import { notification } from "../../service/notifications";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { LocationMap } from "../LocationMap";
import { Tile } from "../Tile";
import { ModalPersonEdit } from "../modals/ModalPersonEdit";
import { Description } from "./Description";
import { PersonDetail } from "./PersonDetailComponent";
import { TimestampItem } from "./TimestampItem";
import { VersionComponent } from "./VersionComponent";
import { LocationSection } from "./LocationSection";
import { PeopleSection } from "./PeopleSection";
import { SimilarPhotosSection } from "./SimilarPhotosSection";

interface SidebarProps {
  isPublic: boolean;
  id: string;
  closeSidepanel: () => void;
  setFaceLocation: (face: { face_id: number; face_url: string }) => void;
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

const SidebarHeader: React.FC<{ closeSidepanel: () => void }> = ({ closeSidepanel }) => (
  <Group justify="space-between">
    <Title order={3}>Details</Title>
    <ActionIcon variant="subtle" color="gray" onClick={closeSidepanel}>
      <X />
    </ActionIcon>
  </Group>
);

export function Sidebar({ isPublic, closeSidepanel, setFaceLocation, id }: SidebarProps) {
  const dispatch = useAppDispatch();
  const [personEditOpen, setPersonEditOpen] = useState(false);
  const [selectedFaces, setSelectedFaces] = useState<SelectedFace[]>([]);
  
  const photoDetail: PhotoType = useAppSelector(store => store.photoDetails.photoDetails[id]);
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();

  if (!photoDetail) {
    return null;
  }

  const notThisPerson = (faceId: number) => {
    const ids = [faceId];
    dispatch(api.endpoints.setFacesPersonLabel.initiate({ faceIds: ids, personName: "Unknown - Other" }));
    notification.removeFacesFromPerson(ids.length);
    dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(photoDetail.image_hash)).refetch();
  };

  const handlePersonEdit = (faceId: string, faceUrl: string) => {
    setSelectedFaces([{ face_id: parseInt(faceId, 10), face_url: faceUrl }]);
    setPersonEditOpen(true);
  };

  const handleModalClose = () => {
    setPersonEditOpen(false);
    setSelectedFaces([]);
    dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(photoDetail.image_hash)).refetch();
  };

  // Apply shadow only on mobile
  const shadowStyle = {
    ...sidebarStyles.container,
    boxShadow: window.innerWidth < 768 ? sidebarStyles.container.boxShadow : 'none',
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
        <LocationSection photoDetail={photoDetail} mapHeight={200} />
        <PeopleSection
          photoDetail={photoDetail}
          isPublic={isPublic}
          setFaceLocation={setFaceLocation}
          onPersonEdit={handlePersonEdit}
          notThisPerson={notThisPerson}
        />
        <Description photoDetail={photoDetail} isPublic={isPublic} />
        <SimilarPhotosSection photoDetail={photoDetail} maxItems={30} />
      </Stack>

      <ModalPersonEdit
        isOpen={personEditOpen}
        onRequestClose={handleModalClose}
        selectedFaces={selectedFaces}
      />
    </Box>
  );
}
