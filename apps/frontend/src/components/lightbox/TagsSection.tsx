import { ActionIcon, Badge, Group, Stack, TagsInput, Text, Title, Tooltip } from "@mantine/core";
import { IconCheck, IconPencil, IconX } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Photo as PhotoType } from "../../api_client/photos/types";
import {
  useAddPhotosToTagMutation,
  useCreateTagMutation,
  useFetchPhotoTagsQuery,
  useFetchTagsQuery,
  useRemovePhotosFromTagMutation,
} from "../../api_client/tags/hooks";
import { notification } from "../../service/notifications";
import { TAG_SUGGESTION_LIMIT, tagOptionsFilter } from "../../util/tagOptionsFilter";

interface TagsSectionProps {
  photoDetail: PhotoType;
}

export function TagsSection({ photoDetail }: TagsSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [draftTags, setDraftTags] = useState<string[]>([]);

  const { data: photoTags } = useFetchPhotoTagsQuery(photoDetail.id);
  const { data: allTags } = useFetchTagsQuery();
  const { mutateAsync: createTag } = useCreateTagMutation();
  const { mutateAsync: addPhotos, isPending: isAdding } = useAddPhotosToTagMutation();
  const { mutateAsync: removePhotos, isPending: isRemoving } = useRemovePhotosFromTagMutation();

  const tags = photoTags ?? [];
  const isSaving = isAdding || isRemoving;

  const handleEditOpen = () => {
    setDraftTags(tags.map(tag => tag.name));
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setDraftTags([]);
  };

  const handleSave = async () => {
    const wanted = draftTags.map(name => name.trim()).filter(name => name.length > 0);
    const removed = tags.filter(tag => !wanted.includes(tag.name));
    const added = wanted.filter(name => !tags.some(tag => tag.name === name));

    try {
      await Promise.all(removed.map(tag => removePhotos({ id: tag.id, name: tag.name, photos: [photoDetail.id] })));
      await Promise.all(
        added.map(async name => {
          // The account may already own the tag through another photo, but
          // allTags only holds the first page - this is a shortcut past a
          // request, not the check. Creating a tag that exists returns it.
          const existing = allTags?.find(tag => tag.name === name);
          const tag = existing ?? (await createTag({ name }));
          await addPhotos({ id: tag.id, name, photos: [photoDetail.id] });
        })
      );
    } catch {
      // Keep the editor open so the edit is not silently lost, and say so:
      // a spinner that just stops looks exactly like a successful save.
      notification.requestFailed(t("lightbox.sidebar.editTags"), t("lightbox.sidebar.tagsSaveFailed"));
      return;
    }

    setEditing(false);
    setDraftTags([]);
  };

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Title order={5}>{t("lightbox.sidebar.tags")}</Title>
        {!editing ? (
          <Tooltip label={t("lightbox.sidebar.editTags")}>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleEditOpen}>
              <IconPencil size={16} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <Group gap="xs">
            <Tooltip label={t("lightbox.sidebar.cancel", "Cancel")}>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleCancel} disabled={isSaving}>
                <IconX size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("lightbox.sidebar.save", "Save")}>
              <ActionIcon variant="subtle" color="blue" size="sm" onClick={handleSave} loading={isSaving}>
                <IconCheck size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      </Group>

      {editing ? (
        <TagsInput
          value={draftTags}
          onChange={setDraftTags}
          data={(allTags ?? []).map(tag => tag.name)}
          filter={tagOptionsFilter}
          limit={TAG_SUGGESTION_LIMIT}
          placeholder={t("lightbox.sidebar.addTag")}
          splitChars={[","]}
          clearable
        />
      ) : tags.length > 0 ? (
        <Group gap="xs">
          {tags.map(tag => (
            <Badge
              key={tag.id}
              color="teal"
              variant="light"
              style={{ cursor: "pointer" }}
              onClick={() => navigate({ to: `/album/tags/${tag.id}` })}
            >
              {tag.name}
            </Badge>
          ))}
        </Group>
      ) : (
        <Text size="sm" c="dimmed">
          {t("lightbox.sidebar.noTags")}
        </Text>
      )}
    </Stack>
  );
}
