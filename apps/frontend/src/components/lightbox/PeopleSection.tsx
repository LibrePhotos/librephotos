import { ActionIcon, Alert, Button, Group, Text, Title, Tooltip } from "@mantine/core";
import { IconUserPlus, IconUsers } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { Photo as PhotoType } from "../../api_client/photos/types";
import { PersonDetail } from "./PersonDetailComponent";

interface PeopleSectionProps {
  photoDetail: PhotoType;
  isPublic: boolean;
  showTitle?: boolean;
  setFaceLocation: (face: { face_id: number; face_url: string }) => void;
  onPersonEdit: (faceId: string, faceUrl: string) => void;
  notThisPerson: (faceId: number) => void;
  /** Absent when adding a face is not available, e.g. on a shared photo. */
  onAddFaceRequest?: () => void;
  onCancelAddFace?: () => void;
  isDrawingFace?: boolean;
  /** Why the photo cannot be drawn on right now, if it cannot. */
  addFaceBlockedReason?: string;
}

export function PeopleSection({
  photoDetail,
  isPublic,
  showTitle = true,
  setFaceLocation,
  onPersonEdit,
  notThisPerson,
  onAddFaceRequest,
  onCancelAddFace,
  isDrawingFace = false,
  addFaceBlockedReason,
}: PeopleSectionProps) {
  const { t } = useTranslation();

  const people = photoDetail.people ?? [];
  const canAddFace = !isPublic && !!onAddFaceRequest;

  // Without the add button there is nothing to show for a photo with no faces,
  // but with it this section is the way to record a face the detector missed --
  // which is exactly the case where the list is empty.
  if (people.length === 0 && !canAddFace) return null;

  return (
    <div>
      {showTitle && (
        <Group justify="space-between">
          <Group>
            <IconUsers />
            <Title order={4}>{t("lightbox.sidebar.people", "People")}</Title>
          </Group>
          {canAddFace && !isDrawingFace && (
            <Tooltip label={addFaceBlockedReason ?? t("lightbox.addface.tooltip")}>
              <ActionIcon
                variant="light"
                color="green"
                aria-label={t("lightbox.addface.tooltip")}
                disabled={!!addFaceBlockedReason}
                onClick={onAddFaceRequest}
              >
                <IconUserPlus />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      )}
      {isDrawingFace && (
        <Alert mt="xs" color="blue" title={t("lightbox.addface.drawtitle")}>
          <Text size="sm">{t("lightbox.addface.drawhint")}</Text>
          <Button mt="xs" size="xs" variant="light" onClick={onCancelAddFace}>
            {t("cancel")}
          </Button>
        </Alert>
      )}
      {people.length === 0 && !isDrawingFace && (
        <Text mt="xs" size="sm" c="dimmed">
          {t("lightbox.addface.nofaces")}
        </Text>
      )}
      <Group mt="xs">
        {people.map(person => (
          <PersonDetail
            key={person.face_id}
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
