import { ActionIcon, Flex, Group, Menu, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconArrowMerge as ArrowMerge,
  IconDotsVertical as DotsVertical,
  IconEdit as Edit,
  IconTag as Tag,
  IconTrash as Trash,
} from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDeleteTagMutation,
  useFetchTagsQuery,
  useMergeTagsMutation,
  useRenameTagMutation,
} from "../../../api_client/tags/hooks";
import gridClasses from "../../../components/album/AlbumGridCell.module.css";
import { TagDeleteModal } from "../../../components/album/TagDeleteModal";
import { TagMergeModal } from "../../../components/album/TagMergeModal";
import { TagRenameModal } from "../../../components/album/TagRenameModal";
import { EmptyState } from "../../../components/common/EmptyState";
import { PageHeader } from "../../../components/PageHeader";
import { Tile } from "../../../components/Tile";
import { VirtualGrid } from "../../../components/virtual/VirtualGrid";
import type { GridCellProps } from "../../../components/virtual/VirtualGrid";
import { ALBUM_GRID_GUTTER, useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";

export const Route = createFileRoute("/_protected/album/tags/")({
  component: AlbumTag,
});

function AlbumTag() {
  const { t } = useTranslation();
  const { data: tags, isFetching } = useFetchTagsQuery();
  const { entriesPerRow, entrySquareSize, numberOfRows, gridHeight } = useAlbumListGridConfig(tags || []);
  const hasTags = tags && tags.length > 0;

  const renameTag = useRenameTagMutation();
  const deleteTag = useDeleteTagMutation();
  const mergeTags = useMergeTagsMutation();

  const [selectedTag, setSelectedTag] = useState<{ id: number; name: string } | null>(null);
  const [isRenameOpen, { open: openRename, close: closeRename }] = useDisclosure(false);
  const [isMergeOpen, { open: openMerge, close: closeMerge }] = useDisclosure(false);
  const [isDeleteOpen, { open: openDelete, close: closeDelete }] = useDisclosure(false);

  function startRename(tag: { id: number; name: string }) {
    setSelectedTag(tag);
    openRename();
  }

  function startMerge(tag: { id: number; name: string }) {
    setSelectedTag(tag);
    openMerge();
  }

  function startDelete(tag: { id: number; name: string }) {
    setSelectedTag(tag);
    openDelete();
  }

  function renderCell({ columnIndex, key, rowIndex, style }: GridCellProps) {
    if (!tags || tags.length === 0) {
      return null;
    }
    const index = rowIndex * entriesPerRow + columnIndex;
    const tag = tags[index];
    if (tag === undefined) {
      return <div key={key} style={style} />;
    }
    const cover = tag.cover_photos[0];
    return (
      <div key={key} style={style}>
        <div className={gridClasses.cell}>
          {cover ? (
            <Link to="/album/tags/$id" params={{ id: String(tag.id) }}>
              <Tile
                className={gridClasses.cover}
                video={cover.video === true}
                height={entrySquareSize - 10}
                width={entrySquareSize - 10}
                image_hash={cover.image_hash}
              />
            </Link>
          ) : (
            <Link to="/album/tags/$id" params={{ id: String(tag.id) }}>
              <Flex
                align="center"
                justify="center"
                h={entrySquareSize - 10}
                w={entrySquareSize - 10}
                bg="var(--mantine-color-default-hover)"
              >
                <Tag size={40} stroke={1.5} color="var(--mantine-color-gray-5)" />
              </Flex>
            </Link>
          )}
        </div>
        <Group justify="space-between" wrap="nowrap">
          <Flex gap={0} justify="left" direction="column" px={8}>
            <Text size="sm" fw={500} lineClamp={1} title={tag.name}>
              {tag.name}
            </Text>
            <Text size="xs">{t("numberofphotos", { count: tag.photo_count, number: tag.photo_count })}</Text>
          </Flex>
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" c="gray" size="sm" aria-label={t("moreactions")}>
                <DotsVertical size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<Edit size={14} />} onClick={() => startRename(tag)}>
                {t("rename")}
              </Menu.Item>
              <Menu.Item leftSection={<ArrowMerge size={14} />} onClick={() => startMerge(tag)}>
                {t("tagalbum.merge")}
              </Menu.Item>
              <Menu.Item leftSection={<Trash size={14} />} onClick={() => startDelete(tag)}>
                {t("delete")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        icon={Tag}
        title={t("tags")}
        loading={isFetching}
        subtitle={t("tagalbum.showingtags", { count: tags?.length ?? 0, number: tags?.length ?? 0 })}
      />
      {!isFetching && !hasTags ? (
        <EmptyState
          icon={<Tag size={40} />}
          title={t("emptystate.tags.title")}
          description={t("emptystate.tags.description")}
          actionLabel={t("emptystate.goToLibrary")}
          actionLink="/library"
        />
      ) : (
        <VirtualGrid
          style={{ outline: "none", paddingLeft: ALBUM_GRID_GUTTER }}
          cellRenderer={renderCell}
          columnWidth={entrySquareSize}
          columnCount={entriesPerRow}
          height={gridHeight}
          rowHeight={entrySquareSize + 60}
          rowCount={numberOfRows}
        />
      )}

      <TagRenameModal
        opened={isRenameOpen}
        onClose={closeRename}
        tagName={selectedTag?.name}
        existingNames={(tags ?? []).map(tag => tag.name)}
        onSubmit={newName => {
          if (selectedTag) {
            renameTag.mutate({ id: selectedTag.id, name: selectedTag.name, newName });
          }
        }}
      />

      <TagMergeModal
        opened={isMergeOpen}
        onClose={closeMerge}
        target={selectedTag}
        tags={tags ?? []}
        onSubmit={source => {
          if (selectedTag) {
            mergeTags.mutate({
              id: selectedTag.id,
              name: selectedTag.name,
              sourceId: source.id,
              sourceName: source.name,
            });
          }
        }}
      />

      <TagDeleteModal
        opened={isDeleteOpen}
        onClose={closeDelete}
        onConfirm={() => {
          if (selectedTag) {
            deleteTag.mutate({ id: selectedTag.id, name: selectedTag.name });
          }
        }}
      />
    </div>
  );
}
