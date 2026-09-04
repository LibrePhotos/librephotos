import { Badge, Button, Divider, Group, Modal, Stack, TagsInput, Text, Title } from "@mantine/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { BulkPhotoQuery } from "../../api_client/photos/types";
import { useFetchTagsQuery, useTagPhotosByNameMutation } from "../../api_client/tags/hooks";
import { notification } from "../../service/notifications";
import { Tile } from "../Tile";
import classes from "./ModalTagEdit.module.css";

/** How many thumbnails of the selection to show before falling back to a count. */
const MAX_PREVIEW_TILES = 12;

type Props = Readonly<{
  isOpen: boolean;
  onRequestClose: () => void;
  /** In select-all mode this holds the EXCLUDED items, not the selection. */
  selectedImages: any[];
  selectAllMode?: boolean;
  selectAllQuery?: BulkPhotoQuery;
  totalCount?: number;
}>;

export function ModalTagEdit(props: Props) {
  const { isOpen, onRequestClose, selectedImages, selectAllMode = false, selectAllQuery, totalCount } = props;
  const { t } = useTranslation();
  const [draftTags, setDraftTags] = useState<string[]>([]);
  // What is typed but not yet committed to a pill. TagsInput only turns text
  // into a pill on a comma, Enter or a blur, so without this a user who types
  // one tag and reaches straight for the button finds it disabled.
  const [pendingTag, setPendingTag] = useState("");

  const { data: allTags } = useFetchTagsQuery();
  const { mutateAsync: tagPhotos, isPending } = useTagPhotosByNameMutation();

  const excludedHashes = selectAllMode ? selectedImages.map(image => image.image_hash) : [];
  const photoCount = selectAllMode ? Math.max(0, (totalCount ?? 0) - selectedImages.length) : selectedImages.length;

  // Trimmed, deduped, and empties dropped -- "beach, , beach," is one tag.
  const names = Array.from(
    new Set([...draftTags, pendingTag].map(name => name.trim()).filter(name => name.length > 0))
  );

  function close() {
    onRequestClose();
    setDraftTags([]);
    setPendingTag("");
  }

  async function handleSubmit() {
    if (names.length === 0) {
      return;
    }

    try {
      await tagPhotos({
        names,
        photos: selectAllMode ? undefined : selectedImages.map(image => image.id),
        selectAll: selectAllMode
          ? { select_all: true, query: selectAllQuery ?? {}, excluded_hashes: excludedHashes }
          : undefined,
        photoCount,
      });
    } catch {
      // Keep the dialog open so the typed tags are not lost, and say so: a
      // spinner that just stops looks exactly like a successful save.
      notification.requestFailed(t("modaltag.title"), t("modaltag.savefailed"));
      return;
    }

    close();
  }

  return (
    <Modal zIndex={1500} opened={isOpen} title={<Title order={3}>{t("modaltag.title")}</Title>} onClose={close}>
      <Stack>
        <Text c="dimmed">{t("modaltag.selectedimages", { count: photoCount })}</Text>

        {selectAllMode ? (
          <Badge color="blue" size="lg" variant="light">
            {t("selectionbar.all")} {photoCount} {t("selectionbar.selected")}
            {excludedHashes.length > 0 && ` (${excludedHashes.length} ${t("selectionbar.excluded")})`}
          </Badge>
        ) : (
          <Group gap="xs">
            {selectedImages.slice(0, MAX_PREVIEW_TILES).map(image => (
              <Tile
                key={`tagsel-${image.id}`}
                className={classes.tile}
                height={40}
                width={40}
                image_hash={image.image_hash}
                video={image.type === "video"}
              />
            ))}
            {selectedImages.length > MAX_PREVIEW_TILES && (
              <Text size="sm" c="dimmed">
                {t("modaltag.andmore", { count: selectedImages.length - MAX_PREVIEW_TILES })}
              </Text>
            )}
          </Group>
        )}

        <Divider />

        <TagsInput
          data-autofocus
          label={t("modaltag.label")}
          description={t("modaltag.hint")}
          value={draftTags}
          onChange={setDraftTags}
          searchValue={pendingTag}
          onSearchChange={setPendingTag}
          data={(allTags ?? []).map(tag => tag.name)}
          placeholder={t("modaltag.placeholder")}
          splitChars={[","]}
          clearable
          // Enter already commits the tag being typed; only submit once the
          // input is empty, so a trailing Enter does not fire the dialog while
          // the user is still listing names.
          onKeyDown={event => {
            if (event.key === "Enter" && pendingTag.trim().length === 0 && draftTags.length > 0) {
              event.preventDefault();
              handleSubmit();
            }
          }}
        />

        <Group justify="flex-end">
          <Button variant="default" onClick={close} disabled={isPending}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} loading={isPending} disabled={names.length === 0 || photoCount === 0}>
            {t("modaltag.add")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
