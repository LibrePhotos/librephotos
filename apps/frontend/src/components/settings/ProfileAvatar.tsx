import { Button, Group, Menu, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconUserSquare as Face, IconPhoto as Photo } from "@tabler/icons-react";
import React, { useRef, useState } from "react";
import type { AvatarEditorRef } from "react-avatar-editor";
import AvatarEditor from "react-avatar-editor";
import type { DropzoneRef } from "react-dropzone";
import Dropzone from "react-dropzone";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/urls";
import { useUpdateAvatarMutation } from "../../api_client/user/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { dataUrlToFile } from "../../util/dataUrl";
import { AvatarFacePickerModal } from "./AvatarFacePickerModal";
import classes from "./ProfileAvatar.module.css";

/** The avatar's size on the page, and of the image that is uploaded. */
const AVATAR_SIZE = 96;

type Props = Readonly<{
  userId: number;
  /** Names the uploaded file. */
  firstName: string;
  /** The stored avatar, if the user has one. */
  avatarUrl: string | null | undefined;
}>;

/**
 * The profile's avatar: a round picture, then in one row beside it the Change menu (upload an
 * image, or pick one of the faces) with the size limit under it. A new picture can be moved into
 * place and is only stored with Save.
 */
export function ProfileAvatar({ userId, firstName, avatarUrl }: Props) {
  const { t } = useTranslation();
  const updateAvatar = useUpdateAvatarMutation();
  const editorRef = useRef<AvatarEditorRef>(null);
  const dropzoneRef = useRef<DropzoneRef>(null);
  const [facePickerOpen, { open: openFacePicker, close: closeFacePicker }] = useDisclosure(false);
  // A picture chosen here: shown instead of the stored one, and unsaved until Save
  const [picked, setPicked] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const stored = avatarUrl ? serverAddress + avatarUrl : "/unknown_user.jpg";

  const pick = (image: string) => {
    setPicked(image);
    setUnsaved(true);
  };

  const save = async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const formData = new FormData();
    const name = `${firstName}avatar.png`;
    const file = await dataUrlToFile(editor.getImageScaledToCanvas().toDataURL(), name);
    formData.append("avatar", file, name);
    updateAvatar.mutate({ id: userId.toString(), data: formData }, { onSuccess: () => setUnsaved(false) });
  };

  return (
    <Group gap="lg" wrap="nowrap" align="center">
      <div className={classes.avatar}>
        {/* noDragEventsBubbling: an avatar dropped here is not also an upload to the library. */}
        <Dropzone
          noClick
          noDragEventsBubbling
          ref={dropzoneRef}
          onDrop={accepted => {
            const [avatarFile] = accepted;
            if (avatarFile) pick(URL.createObjectURL(avatarFile));
          }}
        >
          {({ getRootProps, getInputProps }) => (
            <div {...getRootProps({ className: classes.picture })}>
              <input {...getInputProps()} />
              <AvatarEditor
                ref={editorRef}
                width={AVATAR_SIZE}
                height={AVATAR_SIZE}
                border={0}
                image={picked ?? stored}
              />
            </div>
          )}
        </Dropzone>
      </div>
      <Stack gap={6} align="flex-start">
        <Group gap="xs">
          <Menu position="bottom-start" shadow="md">
            <Menu.Target>
              <Button size="xs" variant="default" aria-label={t("settings.changeavatar")}>
                {t("settings.change")}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<Photo size={ICON_SIZE.menu} />} onClick={() => dropzoneRef.current?.open()}>
                {t("settings.uploadimage")}
              </Menu.Item>
              <Menu.Item leftSection={<Face size={ICON_SIZE.menu} />} onClick={openFacePicker}>
                {t("settings.choosefromface")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          {unsaved && (
            <>
              <Button size="xs" loading={updateAvatar.isPending} onClick={() => void save()}>
                {t("settings.upload")}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => {
                  setPicked(null);
                  setUnsaved(false);
                }}
              >
                {t("cancel")}
              </Button>
            </>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {unsaved ? t("settings.avatarunsaved") : t("settings.filesize")}
        </Text>
      </Stack>
      <AvatarFacePickerModal opened={facePickerOpen} onClose={closeFacePicker} onPick={pick} />
    </Group>
  );
}
