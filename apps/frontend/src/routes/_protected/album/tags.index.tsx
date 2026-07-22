import { ActionIcon, Button, Flex, Group, Menu, Modal, Select, Stack, Text, TextInput } from "@mantine/core";
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
import { AutoSizer, Grid } from "react-virtualized";
import {
  useDeleteTagMutation,
  useFetchTagsQuery,
  useMergeTagsMutation,
  useRenameTagMutation,
} from "../../../api_client/tags/hooks";
import { EmptyState } from "../../../components/common/EmptyState";
import { HeaderComponent } from "../../../components/HeaderComponent";
import { Tile } from "../../../components/Tile";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";

export const Route = createFileRoute("/_protected/album/tags/")();

export function AlbumTag() {
  const { t } = useTranslation();
  const { data: tags, isFetching } = useFetchTagsQuery();
  const { entriesPerRow, entrySquareSize, numberOfRows, gridHeight } = useAlbumListGridConfig(tags || []);
  const hasTags = tags && tags.length > 0;

  const renameTag = useRenameTagMutation();
  const deleteTag = useDeleteTagMutation();
  const mergeTags = useMergeTagsMutation();

  const [selectedTag, setSelectedTag] = useState<{ id: number; name: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [isRenameOpen, { open: openRename, close: closeRename }] = useDisclosure(false);
  const [isMergeOpen, { open: openMerge, close: closeMerge }] = useDisclosure(false);
  const [isDeleteOpen, { open: openDelete, close: closeDelete }] = useDisclosure(false);

  const nameTaken = (tags ?? []).some(tag => tag.name.toLowerCase().trim() === newName.toLowerCase().trim());

  function startRename(tag: { id: number; name: string }) {
    setSelectedTag(tag);
    setNewName("");
    openRename();
  }

  function startMerge(tag: { id: number; name: string }) {
    setSelectedTag(tag);
    setMergeSource(null);
    openMerge();
  }

  function startDelete(tag: { id: number; name: string }) {
    setSelectedTag(tag);
    openDelete();
  }

  function renderCell({ columnIndex, key, rowIndex, style }) {
    if (!tags || tags.length === 0) {
      return null;
    }
    const index = rowIndex * entriesPerRow + columnIndex;
    if (index >= tags.length) {
      return <div key={key} style={style} />;
    }
    const tag = tags[index];
    const cover = tag.cover_photos[0];
    return (
      <div key={key} style={style}>
        <div style={{ padding: 5 }}>
          {cover ? (
            <Link to={`/album/tags/${tag.id}`}>
              <Tile
                video={cover.video === true}
                height={entrySquareSize - 10}
                width={entrySquareSize - 10}
                image_hash={cover.image_hash}
              />
            </Link>
          ) : (
            <Link to={`/album/tags/${tag.id}`}>
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
            <Text size="xs">{t("numberofphotos", { number: tag.photo_count })}</Text>
          </Flex>
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" c="gray" size="sm">
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
      <HeaderComponent
        icon={<Tag size={50} />}
        title={t("tags")}
        fetching={isFetching}
        subtitle={t("tagalbum.showingtags", { number: (tags && tags.length) || 0 })}
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
        <AutoSizer disableHeight style={{ outline: "none", padding: 0, margin: 0 }}>
          {({ width: containerWidth }) => (
            <Grid
              style={{ outline: "none" }}
              disableHeader={false}
              cellRenderer={props => renderCell(props)}
              columnWidth={entrySquareSize}
              columnCount={entriesPerRow}
              height={gridHeight}
              rowHeight={entrySquareSize + 60}
              rowCount={numberOfRows}
              width={containerWidth}
            />
          )}
        </AutoSizer>
      )}

      <Modal size="sm" opened={isRenameOpen} onClose={closeRename} title={t("tagalbum.renametag")}>
        <Stack>
          <TextInput
            label={selectedTag?.name}
            error={nameTaken ? t("tagalbum.tagalreadyexists", { name: newName.trim() }) : ""}
            value={newName}
            onChange={event => setNewName(event.currentTarget.value)}
            placeholder={t("tagalbum.tagplaceholder")}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeRename}>
              {t("cancel")}
            </Button>
            <Button
              color="green"
              disabled={!newName.trim() || nameTaken}
              onClick={() => {
                if (selectedTag) {
                  renameTag.mutate({ id: selectedTag.id, name: selectedTag.name, newName: newName.trim() });
                }
                closeRename();
              }}
            >
              {t("rename")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal size="sm" opened={isMergeOpen} onClose={closeMerge} title={t("tagalbum.mergetag")}>
        <Stack>
          <Text>{t("tagalbum.mergeexplanation", { name: selectedTag?.name ?? "" })}</Text>
          <Select
            searchable
            value={mergeSource}
            onChange={setMergeSource}
            placeholder={t("tagalbum.tagplaceholder")}
            data={(tags ?? [])
              .filter(tag => tag.id !== selectedTag?.id)
              .map(tag => ({ value: `${tag.id}`, label: tag.name }))}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeMerge}>
              {t("cancel")}
            </Button>
            <Button
              color="green"
              disabled={!mergeSource}
              onClick={() => {
                const source = (tags ?? []).find(tag => `${tag.id}` === mergeSource);
                if (selectedTag && source) {
                  mergeTags.mutate({
                    id: selectedTag.id,
                    name: selectedTag.name,
                    sourceId: source.id,
                    sourceName: source.name,
                  });
                }
                closeMerge();
              }}
            >
              {t("tagalbum.merge")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={isDeleteOpen} onClose={closeDelete} title={t("delete")}>
        <Stack>
          <Text>{t("tagalbum.deleteexplanation")}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDelete}>
              {t("cancel")}
            </Button>
            <Button
              color="red"
              onClick={() => {
                if (selectedTag) {
                  deleteTag.mutate({ id: selectedTag.id, name: selectedTag.name });
                }
                closeDelete();
              }}
            >
              {t("confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}

Route.update({ component: AlbumTag });
