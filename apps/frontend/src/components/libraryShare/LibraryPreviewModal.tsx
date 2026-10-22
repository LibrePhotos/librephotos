import type { LibraryShareSwitches, Photo } from "@librephotos/api-client";
import { Group, Modal, Stack, Table, Text } from "@mantine/core";
import { IconEyeOff } from "@tabler/icons-react";
import type { ParseKeys } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoDetailsQuery, useFetchRecentlyAddedPhotosQuery } from "../../api_client/photos/hooks";
import { formatPhotoDateTime } from "../../util/dateUtils";
import { PageLoader } from "../common/PageLoader";
import { Tile } from "../Tile";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  name: string;
  switches: LibraryShareSwitches;
}>;

type Row = Readonly<{ label: ParseKeys; mine: string; shared: boolean }>;

function caption(photo: Photo): string {
  const captions = photo.captions_json ?? {};
  const own = captions["user_caption"];
  const generated = captions["im2txt"];
  if (typeof own === "string" && own.length > 0) return own;
  return typeof generated === "string" ? generated : "";
}

/** One line per field: what I see, and whether the recipient sees it too. */
function previewRows(photo: Photo, switches: LibraryShareSwitches): Row[] {
  const fileName = photo.image_path[0]?.split(/[/\\]/).pop() ?? "";
  return [
    {
      label: "librarySharing.previewDate",
      mine: photo.exif_timestamp ? formatPhotoDateTime(photo.exif_timestamp) : "",
      shared: true,
    },
    { label: "librarySharing.location", mine: photo.search_location ?? "", shared: switches.share_location },
    {
      label: "librarySharing.people",
      mine: photo.people
        .filter(person => person.type === "user")
        .map(person => person.name)
        .join(", "),
      shared: switches.share_faces,
    },
    { label: "librarySharing.camera", mine: photo.camera ?? "", shared: switches.share_camera_info },
    { label: "librarySharing.captions", mine: caption(photo), shared: switches.share_captions },
    { label: "librarySharing.previewFileName", mine: fileName, shared: false },
    { label: "librarySharing.previewFavourite", mine: photo.rating > 0 ? `${photo.rating} ★` : "", shared: false },
  ];
}

function HiddenCell() {
  const { t } = useTranslation();
  return (
    <Group gap={4} wrap="nowrap">
      <IconEyeOff size={14} aria-hidden />
      <Text size="sm" c="dimmed" td="line-through">
        {t("librarySharing.previewHidden")}
      </Text>
    </Group>
  );
}

function PreviewTable({
  photo,
  name,
  switches,
}: Readonly<{ photo: Photo; name: string; switches: LibraryShareSwitches }>) {
  const { t } = useTranslation();
  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th />
          <Table.Th>{t("librarySharing.previewYou")}</Table.Th>
          <Table.Th>{name}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {previewRows(photo, switches).map(row => (
          <Table.Tr key={row.label}>
            <Table.Th scope="row">{t(row.label)}</Table.Th>
            <Table.Td>{row.mine}</Table.Td>
            <Table.Td>{row.shared ? row.mine : <HiddenCell />}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/**
 * "Preview a photo as Ben" (#2731): my newest photo, with what I see beside what the recipient
 * sees under the current switches. Hidden fields say so in words, not only by a strikethrough.
 */
export function LibraryPreviewModal({ opened, onClose, name, switches }: Props) {
  const { t } = useTranslation();
  const { data: recent, isLoading: recentLoading } = useFetchRecentlyAddedPhotosQuery();
  const newest = recent?.results[0];
  const { data: photo, isLoading } = useFetchPhotoDetailsQuery(newest?.id ?? "", !opened || !newest);
  return (
    <Modal opened={opened} onClose={onClose} title={t("librarySharing.previewTitle", { name })} size="lg">
      {recentLoading || (newest && isLoading) ? (
        <PageLoader />
      ) : !photo || !newest ? (
        <Text size="sm">{t("librarySharing.previewNoPhoto")}</Text>
      ) : (
        <Stack>
          <Tile image_hash={newest.id} video={newest.type === "video"} width={160} height={160} />
          <PreviewTable photo={photo} name={name} switches={switches} />
        </Stack>
      )}
    </Modal>
  );
}
