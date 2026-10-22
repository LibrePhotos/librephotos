import type { Photo as PhotoType } from "@librephotos/api-client";
import { ActionIcon, Alert, Button, Group, Text, Title } from "@mantine/core";
import { IconUserPlus, IconUsers } from "@tabler/icons-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDetectFacesReport, useDrawnFaceResult } from "../../api_client/faces";
import { DisabledReason } from "../common/DisabledReason";
import { DetectFacesStatus, DrawnFaceStatus } from "./FaceSearchStatus";
import type { FaceLocationType } from "./lightbox.types";
import { PersonDetail } from "./PersonDetailComponent";

type PeopleSectionProps = {
  /**
   * `id` follows a Detect faces again of this photo, `image_hash` what became of a box drawn on it
   * (#1117); without them neither is shown.
   */
  photoDetail: Pick<PhotoType, "people"> & Partial<Pick<PhotoType, "id" | "image_hash">>;
  isPublic: boolean;
  showTitle?: boolean;
  /**
   * Shown instead of the section's own icon and title, next to its edit
   * controls: the photo page's cards bring their own heading.
   */
  heading?: React.ReactNode;
  setFaceLocation: (location: FaceLocationType) => void;
  onPersonEdit: (faceId: number, faceUrl: string) => void;
  notThisPerson: (faceId: number) => void;
  /** Absent when adding a face is not available, e.g. on a shared photo. */
  onAddFaceRequest?: () => void;
  onCancelAddFace?: () => void;
  isDrawingFace?: boolean;
  /** Why the photo cannot be drawn on right now, if it cannot. */
  addFaceBlockedReason?: string;
};

export function PeopleSection({
  photoDetail,
  isPublic,
  showTitle = true,
  heading,
  setFaceLocation,
  onPersonEdit,
  notThisPerson,
  onAddFaceRequest,
  onCancelAddFace,
  isDrawingFace = false,
  addFaceBlockedReason,
}: PeopleSectionProps) {
  const { t } = useTranslation();

  const people = useMemo(() => photoDetail.people ?? [], [photoDetail.people]);
  const canAddFace = !isPublic && !!onAddFaceRequest;
  const faceIds = useMemo(() => people.map(person => person.face_id), [people]);
  // Detect faces again on this photo answers here (#1117); its new faces are marked
  const detected = useDetectFacesReport(isPublic ? undefined : photoDetail.id, faceIds);
  const newFaceIds = new Set(detected?.newFaceIds);
  // A box drawn here: the face is looked for in it, or is not there (#1117)
  const drawn = useDrawnFaceResult(isPublic ? undefined : photoDetail.image_hash);

  // Without the add button there is nothing to show for a photo with no faces,
  // but with it this section is the way to record a face the detector missed --
  // which is exactly the case where the list is empty.
  if (people.length === 0 && !canAddFace) return null;

  return (
    <div>
      {showTitle && (
        <Group justify="space-between" wrap="nowrap">
          {heading ?? (
            <Group>
              <IconUsers />
              <Title order={4}>{t("lightbox.sidebar.people")}</Title>
            </Group>
          )}
          {canAddFace && !isDrawingFace && (
            <DisabledReason label={t("lightbox.addface.tooltip")} reason={addFaceBlockedReason}>
              <ActionIcon
                variant="light"
                color="green"
                aria-label={t("lightbox.addface.tooltip")}
                onClick={onAddFaceRequest}
              >
                <IconUserPlus />
              </ActionIcon>
            </DisabledReason>
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
      {drawn && <DrawnFaceStatus outcome={drawn} onDrawAgain={canAddFace ? onAddFaceRequest : undefined} />}
      {detected && <DetectFacesStatus outcome={detected} onDrawFace={canAddFace ? onAddFaceRequest : undefined} />}
      {people.length === 0 && !isDrawingFace && !drawn && !detected && (
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
            isNew={newFaceIds.has(person.face_id)}
          />
        ))}
      </Group>
    </div>
  );
}
