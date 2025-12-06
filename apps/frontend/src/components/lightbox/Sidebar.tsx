import { ActionIcon, Box, Group, Stack, Title, useComputedColorScheme, useMantineTheme } from "@mantine/core";
import { IconX as X } from "@tabler/icons-react";
import React, { useState } from "react";
import "react-virtualized/styles.css";
import { useSetFacesPersonLabelMutation } from "../../api_client/faces";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks";
import { notification } from "../../service/notifications";
import { ModalPersonEdit } from "../modals/ModalPersonEdit";
import { AlbumsSection } from "./AlbumsSection";
import { Description } from "./Description";
import { LocationSection } from "./LocationSection";
import { PeopleSection } from "./PeopleSection";
import { SimilarPhotosSection } from "./SimilarPhotosSection";
import { TimestampItem } from "./TimestampItem";
import { VersionComponent } from "./VersionComponent";

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

export function Sidebar({ isPublic, closeSidepanel, setFaceLocation, id }: SidebarProps) {
  const [personEditOpen, setPersonEditOpen] = useState(false);
  const [selectedFaces, setSelectedFaces] = useState<SelectedFace[]>([]);

  const { data: photoDetail } = useFetchPhotoDetailsQuery(id);
  const { mutate: setFacesPersonLabel } = useSetFacesPersonLabelMutation();

  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();

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
        {!isPublic && <AlbumsSection imageHash={photoDetail.image_hash} />}
        <SimilarPhotosSection photoDetail={photoDetail} maxItems={30} />
      </Stack>

      <ModalPersonEdit isOpen={personEditOpen} onRequestClose={handleModalClose} selectedFaces={selectedFaces} />
    </Box>
  );
}
