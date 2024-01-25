import { ActionIcon, Badge, Group, Stack, Text, Title, Tooltip, UnstyledButton } from "@mantine/core";
import { RichTextEditor } from "@mantine/tiptap";
import { IconCheck, IconEdit, IconX, IconNote as Note, IconTags as Tags, IconWand as Wand } from "@tabler/icons-react";
import Document from "@tiptap/extension-document";
import Mention from "@tiptap/extension-mention";
import Paragraph from "@tiptap/extension-paragraph";
import { Text as TipTapText } from "@tiptap/extension-text";
import { useEditor } from "@tiptap/react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { push } from "redux-first-history";

import { generatePhotoIm2txtCaption, savePhotoCaption } from "../../actions/photosActions";
import type { Photo as PhotoType } from "../../actions/photosActions.types";
import { useFetchThingsAlbumsQuery } from "../../api_client/albums/things";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { fuzzyMatch } from "../../util/util";
import "./Hashtag.css";
import suggestion from "./Suggestion";

type Props = Readonly<{
  isPublic: boolean;
  photoDetail: PhotoType;
}>;

export function Description(props: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { generatingCaptionIm2txt } = useAppSelector(store => store.photos);

  const { data: thingAlbums } = useFetchThingsAlbumsQuery();

  const { photoDetail, isPublic } = props;

  const [editMode, setEditMode] = useState(false);
  const [imageCaption, setImageCaption] = useState("");
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
        renderLabel({ options, node }) {
          return `${options.suggestion.char}${node.attrs.label ?? node.attrs.id}`;
        },
        suggestion: {
          items: ({ query }) => {
            if (thingAlbums == null) {
              return [];
            }
            return thingAlbums
              ?.filter(item => fuzzyMatch(query, item.title) && item.thing_type === "hashtag_attribute")
              .map(item => item.title)
              .slice(0, 5)
              .concat(query)
              .reverse();
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

  useEffect(() => {
    if (photoDetail) {
      const currentCaption = photoDetail.captions_json.user_caption ? photoDetail.captions_json.user_caption : "";
      const replacedCaption = currentCaption.replace(/#(\w+)/g, '<span data-type="mention" data-id=$1>#$1</span>');
      editor?.commands.setContent(replacedCaption);
      setImageCaption(currentCaption);
    }
  }, [photoDetail, editor]);

  return (
    <Stack>
      <Stack>
        <Stack>
          <Group>
            <Note />
            <Title order={4}>{t("lightbox.sidebar.caption")}</Title>
          </Group>
          {photoDetail.captions_json.im2txt &&
            editMode &&
            !imageCaption?.includes(photoDetail.captions_json.im2txt) && (
              <div>
                <Group spacing="sm" style={{ paddingBottom: 12 }}>
                  <Wand color="grey" size={20} />
                  <Text size="sm" color="dimmed">
                    Suggestion
                  </Text>
                </Group>
                <UnstyledButton
                  sx={theme => ({
                    display: "block",
                    padding: theme.spacing.xs,
                    borderRadius: theme.radius.xl,
                    textDecoration: "none",
                    fontSize: theme.fontSizes.sm,
                    color: theme.colorScheme === "dark" ? theme.colors.dark[1] : theme.colors.gray[7],
                    backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[4] : theme.colors.gray[1],
                    "&:hover": {
                      backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[3],
                    },
                  })}
                  onClick={() => {
                    editor?.commands.setContent(photoDetail.captions_json.im2txt);
                    setImageCaption(photoDetail.captions_json.im2txt);
                  }}
                >
                  {photoDetail.captions_json.im2txt}
                </UnstyledButton>
                <div style={{ height: 5 }} />
              </div>
            )}
        </Stack>
        <div
          style={{ borderStyle: !editMode ? "none" : "solid", border: "0.0625rem #ced4da", borderRadius: "0.25rem" }}
        >
          <RichTextEditor editor={editor} style={{ borderColor: "none" }}>
            <RichTextEditor.Content style={{ paddingRight: 10 }} />
            {editMode && (
              <ActionIcon
                style={{ position: "absolute", right: 0, top: 0, margin: "5px" }}
                loading={generatingCaptionIm2txt}
                variant="subtle"
                onClick={() => {
                  dispatch(generatePhotoIm2txtCaption(photoDetail.image_hash));
                }}
                disabled={isPublic || (generatingCaptionIm2txt != null && generatingCaptionIm2txt)}
              >
                <Wand />
              </ActionIcon>
            )}
            {!editMode && !isPublic && (
              <ActionIcon
                style={{ position: "absolute", right: 0, top: 0, margin: "5px" }}
                loading={generatingCaptionIm2txt}
                variant="subtle"
                onClick={() => {
                  setEditMode(true);
                  editor?.setEditable(true);
                }}
                disabled={isPublic || (generatingCaptionIm2txt != null && generatingCaptionIm2txt)}
              >
                <IconEdit />
              </ActionIcon>
            )}
          </RichTextEditor>
        </div>
        {editMode && (
          <Group position="center">
            <Tooltip label={t("lightbox.sidebar.cancel")}>
              <ActionIcon
                variant="light"
                onClick={() => {
                  setEditMode(false);
                }}
                color="red"
              >
                <IconX />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("lightbox.sidebar.submit")}>
              <ActionIcon
                variant="light"
                color="green"
                onClick={() => {
                  dispatch(savePhotoCaption(photoDetail.image_hash, imageCaption));
                  setEditMode(false);
                }}
              >
                <IconCheck />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
        {photoDetail.captions_json.places365 && (
          <Stack>
            <Group>
              <Tags />
              <Title order={4}>{t("lightbox.sidebar.scene")}</Title>
            </Group>
            <Text weight={700}>{t("lightbox.sidebar.attributes")}</Text>
            <Group>
              {photoDetail.captions_json.places365.attributes.map(nc => (
                <Badge
                  key={`lightbox_attribute_label_${photoDetail.image_hash}_${nc}`}
                  color="blue"
                  onClick={() => {
                    dispatch(push(`/search/${nc}`));
                  }}
                >
                  {nc}
                </Badge>
              ))}
            </Group>

            <Text weight={700}>{t("lightbox.sidebar.categories")}</Text>
            <Group>
              {photoDetail.captions_json.places365.categories.map(nc => (
                <Badge
                  key={`lightbox_category_label_${photoDetail.image_hash}_${nc}`}
                  color="teal"
                  onClick={() => {
                    dispatch(push(`/search/${nc}`));
                  }}
                >
                  {nc}
                </Badge>
              ))}
            </Group>
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
