import type { Photo as PhotoType } from "@librephotos/api-client";
import { ActionIcon, Group, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconCheck, IconPencil, IconX, IconWand as Wand } from "@tabler/icons-react";
import React, { Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchThingsAlbumsQuery } from "../../api_client/albums/hooks";
import { autoTagsOf, generatedCaptionOf, userCaptionOf } from "../../api_client/photos/captions";
import { useGenerateImageToTextCaptionMutation, useSavePhotoCaptionMutation } from "../../api_client/photos/hooks";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { DisabledReason } from "../common/DisabledReason";
import { FeatureBoundary } from "../common/FeatureBoundary";
import { lazyWithPreload } from "../common/lazyWithPreload";
import { AISuggestionButton } from "./AISuggestionButton";
import type { CaptionInputProps } from "./CaptionInput";
import { CaptionText } from "./CaptionText";
import { SectionTitle } from "./SectionTitle";
import sectionClasses from "./Sidebar.module.css";
import { ThingBadges } from "./ThingBadges";
import { UnsavedBadge } from "./UnsavedBadge";
import { useRegisterDraft } from "./unsavedDrafts";
import { WriteBackHint } from "./WriteBackHint";

/**
 * The editor (tiptap and ProseMirror) is its own chunk, loaded when a caption is edited; the
 * lightbox prefetches it when it opens (see Lightbox.tsx).
 */
export const captionInput = lazyWithPreload<CaptionInputProps>(
  async () => (await import("./CaptionInput")).CaptionInput
);

type Props = Readonly<{
  isPublic: boolean;
  /** All the editor reads: a public page hands it the shared subset of the details. */
  photoDetail: Pick<PhotoType, "image_hash" | "captions_json">;
  /**
   * Shown instead of the section's own icon and title, next to its edit
   * controls: the photo page's cards bring their own heading.
   */
  heading?: React.ReactNode;
  /** Open the editor at once: the photo page's "Add ..." asked for it. */
  startEditing?: boolean;
}>;

export function Description(props: Props) {
  // The draft belongs to one photo: remount when the photo changes, or an editor
  // left open while browsing would carry this photo's text over to the next one.
  return <CaptionEditor key={props.photoDetail.image_hash} {...props} />;
}

/**
 * The editor's life: read-only, open, or open while its save runs. It closes only once the server
 * took the caption; a refused save leaves it open with the draft, still unsaved (#2284).
 */
type EditorMode = "viewing" | "editing" | "saving";

type CaptionHeaderProps = Readonly<{
  heading?: React.ReactNode;
  /** The draft differs from the saved caption (#2284). */
  dirty: boolean;
  mode: EditorMode;
  isPublic: boolean;
  generating: boolean;
  onEdit: () => void;
  onGenerate: () => void;
  onCancel: () => void;
  onSave: () => void;
}>;

/** The section's title (or the card's heading) and its edit controls. */
function CaptionHeader({
  heading,
  dirty,
  mode,
  isPublic,
  generating,
  onEdit,
  onGenerate,
  onCancel,
  onSave,
}: CaptionHeaderProps) {
  const { t } = useTranslation();
  const editMode = mode !== "viewing";
  const saving = mode === "saving";
  return (
    <Group justify="space-between" wrap="nowrap">
      <Group gap="xs" wrap="nowrap">
        {heading ?? <SectionTitle>{t("lightbox.sidebar.caption")}</SectionTitle>}
        {dirty && <UnsavedBadge />}
      </Group>
      {/* Same controls, in the same place, as the tags and keywords below. */}
      {!editMode && !isPublic && (
        <Tooltip label={t("lightbox.sidebar.editCaption")}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={t("lightbox.sidebar.editCaption")}
            loading={generating}
            onClick={onEdit}
          >
            <IconPencil size={16} />
          </ActionIcon>
        </Tooltip>
      )}
      {editMode && (
        <Group gap="xs">
          <Tooltip label={t("lightbox.sidebar.generateCaption")}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={t("lightbox.sidebar.generateCaption")}
              loading={generating}
              onClick={onGenerate}
            >
              <Wand size={16} />
            </ActionIcon>
          </Tooltip>
          <DisabledReason label={t("lightbox.sidebar.cancel")} reason={saving && t("lightbox.sidebar.saving")}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={t("lightbox.sidebar.cancel")}
              onClick={onCancel}
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
              onClick={onSave}
              loading={saving}
            >
              <IconCheck size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      )}
    </Group>
  );
}

/**
 * No caption yet: the owner gets a quiet "Add a caption" that opens the editor, as Google Photos and
 * Immich have it; anyone else is told there is none.
 */
function EmptyField({ isPublic, onAdd }: Readonly<{ isPublic: boolean; onAdd: () => void }>) {
  const { t } = useTranslation();
  if (isPublic) {
    return (
      <Text size="sm" c="dimmed">
        {t("lightbox.sidebar.noCaption")}
      </Text>
    );
  }
  return (
    <UnstyledButton className={sectionClasses.placeholder} onClick={onAdd}>
      {t("lightbox.sidebar.addCaption")}
    </UnstyledButton>
  );
}

/** The editor, once its chunk is in; until then the draft as text, where the editor will be. */
function CaptionInputSlot(props: CaptionInputProps) {
  return (
    <FeatureBoundary name="caption-editor" onReset={captionInput.retry}>
      <Suspense fallback={<CaptionText caption={props.initialCaption} />}>
        <captionInput.Component {...props} />
      </Suspense>
    </FeatureBoundary>
  );
}

function CaptionEditor(props: Props) {
  const { photoDetail, isPublic, heading, startEditing = false } = props;
  // Only the owner edits, so only the owner needs the hashtag suggestions; a
  // public visitor's request for them is refused anyway.
  const { data: thingAlbums } = useFetchThingsAlbumsQuery(isPublic);
  const { data: siteSettings } = useGetSettingsQuery();
  const taggingModel = siteSettings?.tagging_model ?? "openclip_vitb32";

  // Every tagging model stores { tags: string[] } under its own key.
  const autoTags = autoTagsOf(photoDetail.captions_json, taggingModel);
  const savedCaption = userCaptionOf(photoDetail.captions_json);

  const [mode, setMode] = useState<EditorMode>(startEditing && !isPublic ? "editing" : "viewing");
  const editMode = mode !== "viewing";
  // The caption on screen: the saved one, or the draft while editing (and the saved text until a
  // refetch brings it back from the server).
  const [imageCaption, setImageCaption] = useState(savedCaption);
  // A new editor for new content: the editor takes its text only when it is created.
  const [editorKey, setEditorKey] = useState(0);
  const { mutate: updateCaption } = useSavePhotoCaptionMutation();
  const { mutate: generateImageToTextCaptions, isPending: generatingCaptionIm2txt } =
    useGenerateImageToTextCaptionMutation();

  const hashtags = useMemo(
    () => (thingAlbums ?? []).filter(item => item.thing_type === "hashtag_attribute").map(item => item.title),
    [thingAlbums]
  );

  // Only when the saved caption itself changes: a refetch that brings a generated suggestion must
  // not throw away what is being typed. Adjusted while rendering, as React documents it for state
  // derived from a prop.
  const [shownSaved, setShownSaved] = useState(savedCaption);
  if (shownSaved !== savedCaption) {
    setShownSaved(savedCaption);
    setImageCaption(savedCaption);
    setEditorKey(key => key + 1);
  }

  const replaceText = (caption: string) => {
    setImageCaption(caption);
    setEditorKey(key => key + 1);
  };

  const onCancel = () => {
    setMode("viewing");
    setImageCaption(savedCaption);
  };

  const onSave = () => {
    if (mode === "saving") return;
    // Save sits where the pencil was, so a double-click saves straight away:
    // an unchanged caption is not written again (nor announced as saved).
    if (imageCaption === savedCaption) {
      setMode("viewing");
      return;
    }
    setMode("saving");
    updateCaption(
      { id: photoDetail.image_hash, caption: imageCaption },
      { onSuccess: () => setMode("viewing"), onError: () => setMode("editing") }
    );
  };

  // Compared as Save compares it: an editor opened and left unchanged holds nothing to lose.
  const dirty = editMode && imageCaption !== savedCaption;
  useRegisterDraft("caption", dirty);

  const im2txt = generatedCaptionOf(photoDetail.captions_json);
  const isEmpty = !editMode && !imageCaption;

  return (
    <Stack>
      <Stack gap="xs">
        <CaptionHeader
          heading={heading}
          dirty={dirty}
          mode={mode}
          isPublic={isPublic}
          generating={generatingCaptionIm2txt}
          onEdit={() => setMode("editing")}
          onGenerate={() => generateImageToTextCaptions({ id: photoDetail.image_hash })}
          onCancel={onCancel}
          onSave={onSave}
        />
        {im2txt && editMode && !imageCaption.includes(im2txt) && (
          <div>
            <AISuggestionButton suggestion={im2txt} onClick={() => replaceText(im2txt)} />
          </div>
        )}
        {isEmpty && <EmptyField isPublic={isPublic} onAdd={() => setMode("editing")} />}
        {editMode && (
          <CaptionInputSlot
            key={editorKey}
            initialCaption={imageCaption}
            editable={mode === "editing"}
            hashtags={hashtags}
            onChange={setImageCaption}
          />
        )}
        {!editMode && !isEmpty && <CaptionText caption={imageCaption} />}
        {editMode && <WriteBackHint field="caption" />}
      </Stack>
      {autoTags && autoTags.length > 0 && (
        <ThingBadges
          things={autoTags}
          imageHash={photoDetail.image_hash}
          isPublic={isPublic}
          inCard={Boolean(heading)}
        />
      )}
    </Stack>
  );
}
