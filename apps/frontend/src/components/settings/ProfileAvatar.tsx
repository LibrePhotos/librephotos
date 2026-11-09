import { Button, Group, Menu, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconUserSquare as Face, IconPhoto as Photo } from "@tabler/icons-react";
import React, { useRef, useState } from "react";
import type { AvatarEditorRef } from "react-avatar-editor";
import AvatarEditor from "react-avatar-editor";
import type { DropzoneRef } from "react-dropzone";
import Dropzone from "react-dropzone";
import { useTranslation } from "react-i18next";
import { useUpdateAvatarMutation } from "../../api_client/user/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { dataUrlToFile } from "../../util/dataUrl";
import { UserAvatar } from "../common/UserAvatar";
import { AvatarFacePickerModal } from "./AvatarFacePickerModal";
import classes from "./ProfileAvatar.module.css";

/** The avatar's size on the page, and of the image that is uploaded. */
const AVATAR_SIZE = 72;

/**
 * The stored picture, or one picked here: waiting to be moved into place and uploaded, or being
 * uploaded (the conversion included, so a second click finds it busy). A refused upload keeps the
 * picture to try again; an upload that went through shows the stored picture.
 */
type AvatarState = { status: "stored" } | { status: "picked" | "uploading"; image: string };

type Props = Readonly<{
  userId: number;
  /** The user as edited so far: their stored avatar, or the initials of their name; the first name
      names the uploaded file. */
  user: NonNullable<React.ComponentProps<typeof UserAvatar>["user"]>;
}>;

/**
 * The profile's avatar: a 72px round picture (or the user's initials on their colour, as everywhere
 * a user is shown), and beside it the "Change photo" menu (upload an image, or pick one of the
 * faces) with the size limit in 12px under it. A new picture can be moved into place and is only stored
 * with Upload.
 */
export function ProfileAvatar({ userId, user }: Props) {
  const { t } = useTranslation();
  const updateAvatar = useUpdateAvatarMutation();
  const editorRef = useRef<AvatarEditorRef>(null);
  const dropzoneRef = useRef<DropzoneRef>(null);
  const [facePickerOpen, { open: openFacePicker, close: closeFacePicker }] = useDisclosure(false);
  const [avatar, setAvatar] = useState<AvatarState>({ status: "stored" });
  const picked = avatar.status === "stored" ? null : avatar.image;

  const pick = (image: string) => setAvatar({ status: "picked", image });

  const save = async () => {
    const editor = editorRef.current;
    if (avatar.status !== "picked" || !editor) return;
    const { image } = avatar;
    setAvatar({ status: "uploading", image });
    const formData = new FormData();
    const name = `${user.first_name ?? ""}avatar.png`;
    try {
      const file = await dataUrlToFile(editor.getImageScaledToCanvas().toDataURL(), name);
      formData.append("avatar", file, name);
      await updateAvatar.mutateAsync({ id: userId.toString(), data: formData });
      setAvatar({ status: "stored" });
    } catch {
      // A refused upload is toasted by the QueryClient.
      setAvatar({ status: "picked", image });
    }
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
              {picked ? (
                <AvatarEditor ref={editorRef} width={AVATAR_SIZE} height={AVATAR_SIZE} border={0} image={picked} />
              ) : (
                <UserAvatar user={user} size={AVATAR_SIZE} />
              )}
            </div>
          )}
        </Dropzone>
      </div>
      <Stack gap={6} align="flex-start">
        <Group gap="xs">
          <Menu position="bottom-start" shadow="md">
            <Menu.Target>
              <Button size="sm" variant="light">
                {t("settings.changephoto")}
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
          {picked && (
            <>
              <Button size="sm" variant="light" loading={avatar.status === "uploading"} onClick={() => void save()}>
                {t("settings.upload")}
              </Button>
              <Button
                size="sm"
                variant="subtle"
                color="gray"
                disabled={avatar.status === "uploading"}
                onClick={() => setAvatar({ status: "stored" })}
              >
                {t("cancel")}
              </Button>
            </>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {picked ? t("settings.avatarunsaved") : t("settings.filesize")}
        </Text>
      </Stack>
      <AvatarFacePickerModal opened={facePickerOpen} onClose={closeFacePicker} onPick={pick} />
    </Group>
  );
}
