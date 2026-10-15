import type { Photo as PhotoType, Tag } from "@librephotos/api-client";
import type { ComboboxRenderPillInput } from "@mantine/core";
import { ActionIcon, Badge, Group, Pill, Stack, TagsInput, Text, Title, Tooltip } from "@mantine/core";
import { IconCheck, IconFileImport, IconPencil, IconTag, IconX } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoMetadataQuery } from "../../api_client/photos/hooks";
import {
  useAddPhotosToTagMutation,
  useCreateTagMutation,
  useFetchPhotoTagsQuery,
  useFetchTagsQuery,
  useRemovePhotosFromTagMutation,
} from "../../api_client/tags/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { notification } from "../../service/notifications";
import { TAG_SUGGESTION_LIMIT, tagOptionsFilter } from "../../util/tagOptionsFilter";
import { DisabledReason } from "../common/DisabledReason";
import { writeDestination, writeModeOf } from "../settings/metadataWrite";
import classes from "./TagsSection.module.css";
import { UnsavedBadge } from "./UnsavedBadge";
import { useRegisterDraft } from "./unsavedDrafts";
import { WriteBackHint } from "./WriteBackHint";

type TagsSectionProps = {
  photoDetail: PhotoType;
  /**
   * Shown instead of the section's own icon and title, next to its edit
   * controls: the photo page's cards bring their own heading.
   */
  heading?: React.ReactNode;
  /** Open the editor at once: the photo page's "Add ..." asked for it. */
  startEditing?: boolean;
};

/** How a name is compared with the file's keywords: a scan makes a tag of each keyword, trimmed. */
const keywordKey = (name: string) => name.trim().toLowerCase();

/**
 * Tells whether a tag name is among the photo's file keywords (XMP Subject,
 * IPTC Keywords). A scan turns every keyword into a tag, so such a tag came
 * from the file; one the user typed did not.
 */
function useIsFromFile(photoId: string): (name: string) => boolean {
  const { data: metadata } = useFetchPhotoMetadataQuery(photoId);
  const keys = new Set((metadata?.keywords ?? []).map(keywordKey));
  return name => keys.has(keywordKey(name));
}

/** Whether the tags typed differ from the photo's, as Save would see them: order and blanks do not count. */
function draftDiffers(draft: readonly string[], tags: readonly Tag[]): boolean {
  const wanted = new Set(draft.map(name => name.trim()).filter(name => name.length > 0));
  const saved = new Set(tags.map(tag => tag.name));
  return wanted.size !== saved.size || [...wanted].some(name => !saved.has(name));
}

export function TagsSection(props: TagsSectionProps) {
  // The draft belongs to one photo: remount when the photo changes, or an editor
  // left open while browsing would save this photo's tags onto the next one.
  return <TagsEditor key={props.photoDetail.image_hash} {...props} />;
}

/** The file marker. It names itself, so a screen reader hears where the tag came from. */
function FromFileIcon({ inText = false }: { inText?: boolean }) {
  const { t } = useTranslation();
  return (
    <IconFileImport
      size={12}
      className={inText ? `${classes.fromFileIcon} ${classes.inText}` : classes.fromFileIcon}
      role="img"
      aria-label={t("lightbox.sidebar.tagFromFile")}
    />
  );
}

/**
 * The editor's note on the marked tags. While tags stay in LibrePhotos, removing a file tag leaves
 * it in the file and a rescan adds it back; with "Write edits to files" on, the removal reaches the
 * file and sticks (#2289). Nothing until the user's settings are loaded, like WriteBackHint.
 */
function FromFileHint() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUserSelfDetailsQuery();
  if (!user) return null;
  const written = writeDestination("tags", writeModeOf(user.save_metadata_to_disk)) !== "none";
  return (
    <Text size="xs" c="dimmed">
      <IconFileImport size={12} className={`${classes.fromFileIcon} ${classes.inText}`} aria-hidden />
      {t(written ? "lightbox.sidebar.tagsFromFileHintWritten" : "lightbox.sidebar.tagsFromFileHint")}
    </Text>
  );
}

function TagBadge({ tag, fromFile }: { tag: Tag; fromFile: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const badge = (
    // A button, so the tag can be reached and opened from the keyboard, with
    // the focus ring of the edit button above.
    <Badge
      component="button"
      type="button"
      className="mantine-focus-auto"
      color="teal"
      variant="light"
      style={{ cursor: "pointer" }}
      leftSection={fromFile ? <FromFileIcon /> : undefined}
      onClick={() => navigate({ to: `/album/tags/${tag.id}` })}
    >
      {tag.name}
    </Badge>
  );
  if (!fromFile) return badge;
  return (
    <Tooltip
      label={t("lightbox.sidebar.tagFromFile")}
      openDelay={400}
      events={{ hover: true, focus: true, touch: false }}
    >
      {badge}
    </Tooltip>
  );
}

function TagsEditor({ photoDetail, heading, startEditing = false }: TagsSectionProps) {
  const { t } = useTranslation();
  // Only ever started on a photo without tags, so the empty draft is right.
  const [editing, setEditing] = useState(startEditing);
  const [draftTags, setDraftTags] = useState<string[]>([]);

  const { data: photoTags } = useFetchPhotoTagsQuery(photoDetail.id);
  const { data: allTags } = useFetchTagsQuery();
  const { mutateAsync: createTag } = useCreateTagMutation();
  const { mutateAsync: addPhotos, isPending: isAdding } = useAddPhotosToTagMutation();
  const { mutateAsync: removePhotos, isPending: isRemoving } = useRemovePhotosFromTagMutation();
  const isFromFile = useIsFromFile(photoDetail.id);

  const tags = photoTags ?? [];
  const isSaving = isAdding || isRemoving;
  const dirty = editing && draftDiffers(draftTags, tags);
  useRegisterDraft("tags", dirty);

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

  // The same pill TagsInput draws, with the file marker in front of a file keyword.
  const renderPill = ({ value, onRemove, disabled }: ComboboxRenderPillInput) => (
    <Pill withRemoveButton={!disabled} onRemove={onRemove} disabled={disabled}>
      {value !== undefined && isFromFile(value) && <FromFileIcon inText />}
      {value}
    </Pill>
  );

  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          {heading ?? (
            <Group>
              <IconTag />
              <Title order={4}>{t("lightbox.sidebar.tags")}</Title>
            </Group>
          )}
          {dirty && <UnsavedBadge />}
        </Group>
        {!editing ? (
          <Tooltip label={t("lightbox.sidebar.editTags")}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={t("lightbox.sidebar.editTags")}
              onClick={handleEditOpen}
            >
              <IconPencil size={16} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <Group gap="xs">
            <DisabledReason label={t("lightbox.sidebar.cancel")} reason={isSaving && t("lightbox.sidebar.saving")}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={t("lightbox.sidebar.cancel")}
                onClick={handleCancel}
              >
                <IconX size={16} />
              </ActionIcon>
            </DisabledReason>
            <Tooltip label={t("lightbox.sidebar.save")}>
              <ActionIcon
                variant="subtle"
                color="blue"
                size="sm"
                aria-label={t("lightbox.sidebar.save")}
                onClick={handleSave}
                loading={isSaving}
              >
                <IconCheck size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      </Group>

      {editing ? (
        <>
          <TagsInput
            value={draftTags}
            onChange={setDraftTags}
            data={(allTags ?? []).map(tag => tag.name)}
            filter={tagOptionsFilter}
            limit={TAG_SUGGESTION_LIMIT}
            placeholder={t("lightbox.sidebar.addTag")}
            splitChars={[","]}
            renderPill={renderPill}
            clearable
          />
          {draftTags.some(isFromFile) && <FromFileHint />}
          <WriteBackHint field="tags" />
        </>
      ) : tags.length > 0 ? (
        <Group gap="xs">
          {tags.map(tag => (
            <TagBadge key={tag.id} tag={tag} fromFile={isFromFile(tag.name)} />
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
