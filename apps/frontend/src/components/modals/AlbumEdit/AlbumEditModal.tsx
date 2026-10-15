import type { BulkPhotoQuery, PigPhoto } from "@librephotos/api-client";
import { Badge, Button, Divider, Group, Modal, Stack, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  useAddPhotoToUserAlbumMutation,
  useCreateUserAlbumMutation,
  useFetchUserAlbumsQuery,
} from "../../../api_client/albums/hooks";
import type { SelectAllAlbumFields } from "../../../api_client/albums/types";
import { fuzzyMatch } from "../../../util/util";
import { AlbumListItem } from "../../album/AlbumListItem";
import { selectionLabel } from "../../photolist/selectionLabel";
import { Tile } from "../../Tile";
import { modalTitleStyles } from "../modalTitleStyles";
import classes from "./AlbumEditModal.module.css";
import { makeNewAlbumSchema } from "./AlbumEditModal.schema";

type Props = Readonly<{
  isOpen: boolean;
  onRequestClose: () => void;
  // In select-all mode this holds the EXCLUDED items, not the selection.
  selectedImages: ReadonlyArray<Pick<PigPhoto, "id" | "image_hash" | "type">>;
  selectAllMode?: boolean;
  selectAllQuery?: BulkPhotoQuery;
  totalCount?: number;
}>;

export function AlbumEditModal(props: Props) {
  const { isOpen, onRequestClose, selectedImages, selectAllMode = false, selectAllQuery, totalCount } = props;
  const { t } = useTranslation();
  const { data: albumsUserList = [] } = useFetchUserAlbumsQuery();
  const createUserAlbum = useCreateUserAlbumMutation();
  const addPhotoToUserAlbum = useAddPhotoToUserAlbumMutation();
  // The new album's title, which also filters the list of albums below it. The server refuses a
  // blank title (400) and the modal closes before the request settles, so an empty or duplicate
  // name must not be submittable.
  const form = useForm({
    initialValues: { title: "" },
    validate: schemaResolver(
      makeNewAlbumSchema(
        t,
        albumsUserList.map(album => album.title)
      ),
      { sync: true }
    ),
    validateInputOnChange: ["title"],
    transformValues: ({ title }) => ({ title: title.trim() }),
  });
  const trimmedTitle = form.values.title.trim();

  const excludedHashes = selectAllMode ? selectedImages.map(i => i.image_hash) : [];
  const effectiveCount = selectAllMode ? Math.max(0, (totalCount ?? 0) - selectedImages.length) : selectedImages.length;

  // The server resolves select-all through the same query the view uses (incl.
  // the photos/videos filter), so the payload matches exactly what is on screen.
  const selectAllFields: SelectAllAlbumFields = {
    select_all: true,
    query: selectAllQuery ?? {},
    excluded_hashes: excludedHashes,
    photoCount: effectiveCount,
  };

  // The parent keeps this component mounted, so every way out must clear the
  // title: a leftover filter would otherwise reopen hidden behind an empty input.
  const close = () => {
    onRequestClose();
    form.reset();
  };

  return (
    <Modal styles={modalTitleStyles} zIndex={1500} opened={isOpen} title={t("modalalbum.title")} onClose={close}>
      <Stack>
        <Text c="dimmed">{t("modalalbum.selectedimages", { count: effectiveCount })}</Text>
        {selectAllMode ? (
          <Badge color="blue" size="lg" variant="light">
            {selectionLabel(t, {
              selectAllMode,
              total: totalCount ?? 0,
              excluded: excludedHashes.length,
              selected: selectedImages.length,
            })}
          </Badge>
        ) : (
          <Group>
            {selectedImages.map(image => (
              <Tile
                key={`si-${image.id}`}
                className={classes.tile}
                height={40}
                width={40}
                image_hash={image.image_hash}
                video={image.type === "video"}
              />
            ))}
          </Group>
        )}
        <Divider />
        <Title order={4}>{t("modalalbum.newalbum")}</Title>
        <Group>
          <TextInput placeholder={t("modalalbum.placeholder")} {...form.getInputProps("title")} />
          {/* No <form>, as before: the field also filters the list, so Enter does not create an album */}
          <Button
            onClick={() =>
              form.onSubmit(({ title }) => {
                createUserAlbum.mutate({
                  title,
                  photos: selectAllMode ? [] : selectedImages.map(i => i.id),
                  ...(selectAllMode ? selectAllFields : {}),
                });
                close();
              })()
            }
            disabled={!form.isValid()}
            type="submit"
          >
            {t("modalalbum.create")}
          </Button>
        </Group>
        <Divider />
        <Stack className={classes.albums}>
          {albumsUserList
            .filter(el => fuzzyMatch(trimmedTitle, el.title))
            .map(item => (
              <div key={`ub-${item.id}`}>
                <UnstyledButton
                  disabled={item.locked}
                  aria-label={item.locked ? t("useralbum.lockedCannotAdd", { title: item.title }) : undefined}
                  onClick={() => {
                    if (item.locked) return;
                    addPhotoToUserAlbum.mutate({
                      id: `${item.id}`,
                      title: item.title,
                      photos: selectAllMode ? [] : selectedImages.map(i => i.id),
                      ...(selectAllMode ? selectAllFields : {}),
                    });
                    close();
                  }}
                >
                  <Group gap="xs" wrap="nowrap">
                    <AlbumListItem album={item} showUpdatedTime />
                    {item.locked && <Badge color="gray">{t("useralbum.locked")}</Badge>}
                  </Group>
                </UnstyledButton>
              </div>
            ))}
        </Stack>
      </Stack>
    </Modal>
  );
}
