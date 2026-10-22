import type { BulkPhotoQuery, UserAlbum, UserAlbumInfo } from "@librephotos/api-client";
import { Button, Group, Stack, Text, Title } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useAddPhotosToSharedAlbumMutation, useFetchUserAlbumQuery } from "../../../api_client/albums/hooks";
import { PageLoader } from "../../common/PageLoader";
import { ConsentTable } from "../../sharing/ConsentTable";
import { sharerName } from "../../sharing/sharerGroups";

type Props = Readonly<{
  album: UserAlbumInfo;
  photoIds: string[];
  selectAll?: { query: BulkPhotoQuery; excludedHashes: string[] };
  count: number;
  myId: number | null;
  onBack: () => void;
  onDone: () => void;
}>;

/** Everyone in the album but you: the owner first, then the members. */
function otherPeople(album: UserAlbum, myId: number | null): string {
  const people = [album.owner, ...album.members.map(member => member.user)];
  return people
    .filter(person => person.id !== myId)
    .map(person => sharerName(person, person.username))
    .join(", ");
}

/**
 * The second step of adding photos to an album shared with you (#464): who will see them, and what
 * of them (the album's ceiling and your own switches), before anything is added.
 */
export function ContributeStep({ album, photoIds, selectAll, count, myId, onBack, onDone }: Props) {
  const { t } = useTranslation();
  const { data: detail } = useFetchUserAlbumQuery(String(album.id));
  const add = useAddPhotosToSharedAlbumMutation();

  return (
    <Stack>
      <Title order={4}>{t("collab.addTitle", { count, title: album.title })}</Title>
      {detail ? (
        <>
          <Text size="sm">{t("collab.whoWillSee", { names: otherPeople(detail, myId) })}</Text>
          <ConsentTable album={detail} />
          <Text size="xs" c="dimmed">
            {t("collab.consentNote")}
          </Text>
        </>
      ) : (
        <PageLoader />
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onBack}>
          {t("collab.back")}
        </Button>
        <Button
          loading={add.isPending}
          onClick={() =>
            add.mutate({ albumId: String(album.id), title: album.title, photoIds, selectAll }, { onSuccess: onDone })
          }
        >
          {t("collab.add", { title: album.title })}
        </Button>
      </Group>
    </Stack>
  );
}
