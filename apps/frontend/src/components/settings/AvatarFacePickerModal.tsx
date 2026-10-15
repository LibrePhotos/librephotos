import { Avatar, Modal, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconUserSearch } from "@tabler/icons-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPeopleAlbumsQuery } from "../../api_client/albums/hooks";
import { EmptyState } from "../common/EmptyState";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { faceImageUrl } from "../facedashboard/personCover";
import { modalTitleStyles } from "../modals/modalTitleStyles";
import { TileGrid } from "../virtual/TileGrid";
import { useMeasuredTileSizing } from "../virtual/useMeasuredTileSizing";

// The name under the face (md, 24.8px) with a little room.
const CAPTION_HEIGHT = 32;
const MIN_TILE_WIDTH = 120;

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The URL of the face crop the user picked, for the avatar editor to load. */
  onPick: (faceUrl: string) => void;
}>;

/** Your people, each with its cover face: pick one to start the avatar from that face. */
export function AvatarFacePickerModal({ opened, onClose, onPick }: Props) {
  const { t } = useTranslation();
  const peopleQuery = useFetchPeopleAlbumsQuery(!opened);
  const failure = useListFailure(peopleQuery);
  // Someone without a cover face has nothing to pick.
  const people = useMemo(() => (peopleQuery.data ?? []).filter(person => person.face_url), [peopleQuery.data]);
  // The modal's own header and padding
  const { ref, sizing } = useMeasuredTileSizing({
    columnsFor: width => Math.max(2, Math.floor(width / MIN_TILE_WIDTH)),
    cellPadding: 8,
    captionHeight: CAPTION_HEIGHT,
    reservedHeight: 300,
  });

  const renderBody = () => {
    if (failure) return <ErrorState compact failure={failure} />;
    if (peopleQuery.data === undefined) return <PageLoader />;
    if (people.length === 0) {
      return (
        <EmptyState
          icon={<IconUserSearch size={40} />}
          title={t("settings.facepicker.emptytitle")}
          description={t("settings.facepicker.emptydescription")}
        />
      );
    }
    return (
      <TileGrid
        items={people}
        getKey={person => person.id}
        sizing={sizing}
        renderItem={(person, size) => (
          <UnstyledButton
            aria-label={t("settings.facepicker.pick", { name: person.name })}
            onClick={() => {
              onPick(faceImageUrl(person.face_url));
              onClose();
            }}
          >
            <Avatar src={faceImageUrl(person.face_url)} alt="" radius="md" size={size} />
          </UnstyledButton>
        )}
        renderCaption={person => (
          <Text size="sm" ta="center" lineClamp={1} title={person.name}>
            {person.name}
          </Text>
        )}
      />
    );
  };

  return (
    <Modal
      styles={modalTitleStyles}
      zIndex={1500}
      opened={opened}
      title={t("settings.facepicker.title")}
      onClose={onClose}
      size="lg"
    >
      <Stack gap="sm">
        <Text c="dimmed" size="sm">
          {t("settings.facepicker.hint")}
        </Text>
        <div ref={ref}>{renderBody()}</div>
      </Stack>
    </Modal>
  );
}
