import { Group, Title } from "@mantine/core";
import { IconUsers } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

import type { Photo as PhotoType } from "../../api_client/photos/photosActions.types";
import { PersonDetail } from "./PersonDetailComponent";

interface PeopleSectionProps {
  photoDetail: PhotoType;
  isPublic: boolean;
  showTitle?: boolean;
  setFaceLocation: (face: { face_id: number; face_url: string }) => void;
  onPersonEdit: (faceId: string, faceUrl: string) => void;
  notThisPerson: (faceId: number) => void;
}

export function PeopleSection({ 
  photoDetail, 
  isPublic,
  showTitle = true,
  setFaceLocation,
  onPersonEdit,
  notThisPerson
}: PeopleSectionProps) {
  const { t } = useTranslation();
  
  if (!photoDetail.people || photoDetail.people.length === 0) return null;

  return (
    <div>
      {showTitle && (
        <Group>
          <IconUsers />
          <Title order={4}>{t("lightbox.sidebar.people", "People")}</Title>
        </Group>
      )}
      <Group mt="xs">
        {photoDetail.people.map(person => (
          <PersonDetail
            key={person.name}
            person={person}
            isPublic={isPublic}
            setFaceLocation={setFaceLocation}
            onPersonEdit={onPersonEdit}
            notThisPerson={notThisPerson}
          />
        ))}
      </Group>
    </div>
  );
} 