import { ActionIcon, Badge, Group, Stack, Text, Title, Tooltip } from "@mantine/core";
import { RichTextEditor } from "@mantine/tiptap";
import {
  IconCheck,
  IconPencil,
  IconX,
  IconNote as Note,
  IconTags as Tags,
  IconWand as Wand,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import Document from "@tiptap/extension-document";
import Mention from "@tiptap/extension-mention";
import Paragraph from "@tiptap/extension-paragraph";
import { Text as TipTapText } from "@tiptap/extension-text";
import { useEditor } from "@tiptap/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchThingsAlbumsQuery } from "../../api_client/albums/hooks";
import { autoTagsOf, generatedCaptionOf, userCaptionOf } from "../../api_client/photos/captions";
import { useGenerateImageToTextCaptionMutation, useSavePhotoCaptionMutation } from "../../api_client/photos/hooks";
import type { Photo as PhotoType } from "../../api_client/photos/types";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { fuzzyMatch } from "../../util/util";
import { AISuggestionButton } from "./AISuggestionButton";
import classes from "./Description.module.css";
import "./Hashtag.css";
import suggestion from "./Suggestion";

type Props = Readonly<{
  isPublic: boolean;
  /** All the editor reads: a public page hands it the shared subset of the details. */
  photoDetail: Pick<PhotoType, "image_hash" | "captions_json">;
}>;

/** Captions are saved as plain text; the editor shows their hashtags as mentions. */
function captionToEditorHtml(caption: string): string {
  return caption.replace(/#(\w+)/g, '<span data-type="mention" data-id=$1>#$1</span>');
}

export function Description(props: Props) {
  // The draft belongs to one photo: remount when the photo changes, or an editor
  // left open while browsing would carry this photo's text over to the next one.
  return <CaptionEditor key={props.photoDetail.image_hash} {...props} />;
}

function CaptionEditor(props: Props) {
  const { photoDetail, isPublic } = props;
  const { t } = useTranslation();
  // Only the owner edits, so only the owner needs the hashtag suggestions; a
  // public visitor's request for them is refused anyway.
  const { data: thingAlbums } = useFetchThingsAlbumsQuery(isPublic);
  const { data: siteSettings } = useGetSettingsQuery();
  const taggingModel = siteSettings?.tagging_model ?? "openclip_vitb32";
  const navigate = useNavigate();

  // Every tagging model stores { tags: string[] } under its own key.
  const autoTags = autoTagsOf(photoDetail.captions_json, taggingModel);
  const savedCaption = userCaptionOf(photoDetail.captions_json);

  const [editMode, setEditMode] = useState(false);
  const [imageCaption, setImageCaption] = useState<string | null>(null);
  const { mutate: updateCaption } = useSavePhotoCaptionMutation();
  const { mutate: generateImageToTextCaptions, isPending: generatingCaptionIm2txt } =
    useGenerateImageToTextCaptionMutation();

  // The editor reads its extensions once, when it is created, so the hashtag
  // suggestions look the albums up when asked instead of closing over them.
  const hashtagsRef = useRef<string[]>([]);
  hashtagsRef.current = (thingAlbums ?? [])
    .filter(item => item.thing_type === "hashtag_attribute")
    .map(item => item.title);

  const editor = useEditor({
    editable: editMode,
    extensions: [
      Document,
      Paragraph,
      TipTapText,
      Mention.configure({
        HTMLAttributes: {
          class: "hashtag",
        },
        // renderLabel is deprecated in tiptap v3 and warns on every render.
        renderText({ options, node }) {
          return `${options.suggestion.char}${node.attrs.label ?? node.attrs.id}`;
        },
        renderHTML({ options, node }) {
          return ["span", options.HTMLAttributes, `${options.suggestion.char}${node.attrs.label ?? node.attrs.id}`];
        },
        suggestion: {
          items: ({ query }) => {
            const matches = hashtagsRef.current.filter(title => fuzzyMatch(query, title)).slice(0, 5);
            // Offer what was typed as a new hashtag, but not an empty one for a
            // bare "#", and not a second copy of an existing one.
            if (query && !matches.includes(query)) {
              matches.push(query);
            }
            return matches.reverse();
          },
          char: suggestion.char,
          render: suggestion.render,
        },
      }),
    ],
    content: imageCaption,
    // eslint-disable-next-line @typescript-eslint/no-shadow
    onUpdate({ editor }) {
      setImageCaption(editor.getText());
    },
  });

  const showSavedCaption = useCallback(() => {
    editor?.commands.setContent(captionToEditorHtml(savedCaption));
    setImageCaption(savedCaption);
  }, [editor, savedCaption]);

  // Only when the saved caption itself changes: a refetch that brings a
  // generated suggestion must not throw away what is being typed.
  useEffect(() => showSavedCaption(), [showSavedCaption]);

  const setEditing = (editing: boolean) => {
    setEditMode(editing);
    // useEditor only reads `editable` when it creates the editor.
    editor?.setEditable(editing);
    if (editing) {
      editor?.commands.focus("end");
    }
  };

  const onCancel = () => {
    setEditing(false);
    showSavedCaption();
  };

  const onSave = () => {
    // Save sits where the pencil was, so a double-click saves straight away:
    // an unchanged caption is not written again (nor announced as saved).
    if ((imageCaption ?? "") !== savedCaption) {
      updateCaption({ id: photoDetail.image_hash, caption: imageCaption || "" });
    }
    setEditing(false);
  };

  const im2txt = generatedCaptionOf(photoDetail.captions_json);
  const isEmpty = !editMode && !(imageCaption ?? savedCaption);

  return (
    <Stack>
      <Stack gap="xs">
        <Group justify="space-between">
          <Group>
            <Note />
            <Title order={4}>{t("lightbox.sidebar.caption")}</Title>
          </Group>
          {/* Same controls, in the same place, as the tags and keywords below. */}
          {!editMode && !isPublic && (
            <Tooltip label={t("lightbox.sidebar.editCaption")}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={t("lightbox.sidebar.editCaption")}
                loading={generatingCaptionIm2txt}
                onClick={() => setEditing(true)}
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
                  loading={generatingCaptionIm2txt}
                  onClick={() => {
                    generateImageToTextCaptions({ id: photoDetail.image_hash });
                  }}
                >
                  <Wand size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("lightbox.sidebar.cancel")}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={t("lightbox.sidebar.cancel")}
                  onClick={onCancel}
                >
                  <IconX size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("lightbox.sidebar.save")}>
                <ActionIcon
                  variant="subtle"
                  color="blue"
                  size="sm"
                  aria-label={t("lightbox.sidebar.save")}
                  onClick={onSave}
                >
                  <IconCheck size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          )}
        </Group>
        {im2txt && editMode && !imageCaption?.includes(im2txt) && (
          <div>
            <AISuggestionButton
              suggestion={im2txt}
              onClick={() => {
                editor?.commands.setContent(im2txt);
                setImageCaption(im2txt);
              }}
            />
          </div>
        )}
        {isEmpty && (
          <Text size="sm" c="dimmed">
            {t("lightbox.sidebar.noCaption")}
          </Text>
        )}
        {/* Hidden rather than unmounted when empty, so the editor keeps its view. */}
        <RichTextEditor
          editor={editor}
          className={classes.caption}
          mod={{ "read-only": !editMode }}
          display={isEmpty ? "none" : undefined}
        >
          <RichTextEditor.Content />
        </RichTextEditor>
      </Stack>
      {autoTags && autoTags.length > 0 && (
        <Stack gap="xs">
          <Group>
            <Tags />
            {/* The tagging model's own output, not the user's tags -- both
                used to render as "Tags" in the same sidebar. */}
            <Title order={4}>{t("lightbox.sidebar.autotags")}</Title>
          </Group>
          <Group gap="xs">
            {autoTags.map(tag =>
              // Search needs a login, so a public page's tags are just labels;
              // the owner's are buttons, so the keyboard can reach them too.
              isPublic ? (
                <Badge key={`lightbox_autotag_${photoDetail.image_hash}_${tag}`} color="green" variant="light">
                  {tag}
                </Badge>
              ) : (
                <Badge
                  key={`lightbox_autotag_${photoDetail.image_hash}_${tag}`}
                  component="button"
                  type="button"
                  className="mantine-focus-auto"
                  color="green"
                  variant="light"
                  style={{ cursor: "pointer" }}
                  onClick={() => navigate({ to: `/search/${encodeURIComponent(tag)}` })}
                >
                  {tag}
                </Badge>
              )
            )}
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
