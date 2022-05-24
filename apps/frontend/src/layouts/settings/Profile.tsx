import {
  ActionIcon,
  Button,
  Dialog,
  Group,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  useMantineColorScheme,
} from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import AvatarEditor from "react-avatar-editor";
import Dropzone, { DropzoneRef } from "react-dropzone";
import { Trans, useTranslation } from "react-i18next";
import { MoonStars, Photo, Sun, Upload, User } from "tabler-icons-react";

import { updateAvatar, updateUser } from "../../actions/utilActions";
import { api } from "../../api_client/api";
import { serverAddress } from "../../api_client/apiClient";
import { useAppDispatch, useAppSelector } from "../../store/store";

export const Profile = () => {
  const [isOpenUpdateDialog, setIsOpenUpdateDialog] = useState(false);
  const [avatarImgSrc, setAvatarImgSrc] = useState("/unknown_user.jpg");
  const [userSelfDetails, setUserSelfDetails] = useState({} as any);
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const userSelfDetailsRedux = useAppSelector(state => state.user.userSelfDetails);
  const { t, i18n } = useTranslation();

  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";
  let editor = useRef(null);

  const setEditorRef = newEditor => (editor = newEditor);

  let dropzoneRef = React.useRef<DropzoneRef>();

  const urltoFile = (url, filename, mimeType) => {
    mimeType = mimeType || (url.match(/^data:([^;]+);/) || "")[1];
    return fetch(url)
      .then(res => res.arrayBuffer())
      .then(buf => new File([buf], filename, { type: mimeType }));
  };

  // open update dialog, when user was edited
  useEffect(() => {
    if (JSON.stringify(userSelfDetailsRedux) !== JSON.stringify(userSelfDetails)) {
      setIsOpenUpdateDialog(true);
    } else {
      setIsOpenUpdateDialog(false);
    }
  }, [userSelfDetailsRedux, userSelfDetails]);

  useEffect(() => {
    dispatch(api.endpoints.fetchUserSelfDetails.initiate(auth.access.user_id)).refetch();
  }, []);

  useEffect(() => {
    setUserSelfDetails(userSelfDetailsRedux);
  }, [userSelfDetailsRedux]);

  if (avatarImgSrc === "/unknown_user.jpg") {
    if (userSelfDetails.avatar_url) {
      setAvatarImgSrc(serverAddress + userSelfDetails.avatar_url);
    }
  }
  return (
    <Stack align="center" justify="flex-start">
      <Group spacing="xs">
        <User size={35} />
        <Title order={2}>{t("settings.profile")}</Title>
      </Group>
      <Stack align="flex-start">
        <Group>
          <div
            style={{
              display: "inline-block",
              verticalAlign: "top",
              padding: 5,
            }}
          >
            <Dropzone
              noClick
              //@ts-ignore
              style={{ width: 150, height: 150, borderRadius: 75 }}
              ref={node => {
                //@ts-ignore
                dropzoneRef = node;
              }}
              onDrop={(accepted, rejected) => {
                setAvatarImgSrc(URL.createObjectURL(accepted[0]));
              }}
            >
              {({ getRootProps, getInputProps }) => (
                <div {...getRootProps()}>
                  <input {...getInputProps()} />
                  <AvatarEditor ref={setEditorRef} width={150} height={150} border={0} image={avatarImgSrc} />
                </div>
              )}
            </Dropzone>
          </div>
          <div
            style={{
              display: "inline-block",
              verticalAlign: "top",
              padding: 5,
            }}
          >
            <p>
              <b>
                <Trans i18nKey="settings.uploadheader">Upload new avatar</Trans>
              </b>
            </p>
            <Group>
              <Button
                size="sm"
                onClick={() => {
                  //@ts-ignore
                  dropzoneRef.open();
                }}
              >
                <Photo />
                <Trans i18nKey="settings.image">Choose image</Trans>
              </Button>
              <Button
                size="sm"
                color="green"
                onClick={() => {
                  const form_data = new FormData();
                  // @ts-ignore
                  urltoFile(
                    // @ts-ignore
                    editor.getImageScaledToCanvas().toDataURL(),
                    `${userSelfDetails.first_name}avatar.png`
                  ).then(file => {
                    form_data.append("avatar", file, `${userSelfDetails.first_name}avatar.png`);
                    dispatch(updateAvatar(userSelfDetails, form_data));
                  });
                }}
              >
                <Upload />
                <Trans i18nKey="settings.upload">Upload</Trans>
              </Button>
            </Group>
            <p>
              <Trans i18nKey="settings.filesize">The maximum file size allowed is 200KB.</Trans>
            </p>
          </div>
        </Group>
        <Stack>
          <Group>
            <TextInput
              onChange={event => {
                setUserSelfDetails({ ...userSelfDetails, first_name: event.currentTarget.value });
              }}
              label={t("settings.firstname")}
              placeholder={t("settings.firstnameplaceholder")}
              value={userSelfDetails.first_name}
            />
            <TextInput
              onChange={event => {
                setUserSelfDetails({ ...userSelfDetails, last_name: event.currentTarget.value });
              }}
              label={t("settings.lastname")}
              placeholder={t("settings.lastnameplaceholder")}
              value={userSelfDetails.last_name}
            />
          </Group>
          <TextInput
            label={t("settings.email")}
            placeholder={t("settings.emailplaceholder")}
            value={userSelfDetails.email}
            onChange={event => {
              setUserSelfDetails({ ...userSelfDetails, email: event.currentTarget.value });
            }}
          />
          <Select
            label={t("settings.language")}
            placeholder={t("settings.language")}
            //@ts-ignore
            onChange={value => i18n.changeLanguage(value)}
            searchable
            maxDropdownHeight={280}
            value={window.localStorage.i18nextLng}
            data={[
              {
                value: "gb",
                label: t("settings.english"),
              },
              {
                value: "de",
                label: t("settings.german"),
              },
              {
                value: "es",
                label: t("settings.spanish"),
              },
              {
                value: "fr",
                label: t("settings.french"),
              },
              {
                value: "it",
                label: t("settings.italian"),
              },
              {
                value: "nb_NO",
                label: t("settings.norwegianbokmal"),
              },
              {
                value: "zh_Hans",
                label: t("settings.simplifiedchinese"),
              },
              {
                value: "ru",
                label: t("settings.russian"),
              },
              {
                value: "ja",
                label: t("settings.japanese"),
              },
              {
                value: "sv",
                label: t("settings.swedish"),
              },
              {
                value: "pl",
                label: t("settings.polish"),
              },
              {
                value: "nl",
                label: t("settings.dutch"),
              },
            ]}
          />
          <Switch
            label={`${t("settings.thumbnailsize")}: ${
              userSelfDetails.image_scale === 1 ? t("settings.big") : t("settings.small")
            }`}
            onChange={event => {
              if (event.currentTarget.checked) {
                setUserSelfDetails({ ...userSelfDetails, image_scale: 1 });
              } else {
                setUserSelfDetails({ ...userSelfDetails, image_scale: 2 });
              }
            }}
            checked={userSelfDetails.image_scale === 1}
          />
        </Stack>{" "}
        {auth.isAdmin ? (
          <TextInput
            type="text"
            label={t("settings.scandirectory")}
            disabled
            placeholder={userSelfDetails.scan_directory}
          ></TextInput>
        ) : null}
        <ActionIcon
          variant="outline"
          color={dark ? "yellow" : "blue"}
          onClick={() => toggleColorScheme()}
          title="Toggle color scheme"
        >
          {dark ? <Sun size={18} /> : <MoonStars size={18} />}
        </ActionIcon>
      </Stack>
      <Dialog
        opened={isOpenUpdateDialog}
        withCloseButton
        onClose={() => setIsOpenUpdateDialog(false)}
        size="lg"
        radius="md"
      >
        <Text size="sm" style={{ marginBottom: 10 }} weight={500}>
          Save Changes?
        </Text>

        <Group align="flex-end">
          <Button
            size="sm"
            color="green"
            onClick={() => {
              const newUserData = userSelfDetails;
              delete newUserData.scan_directory;
              delete newUserData.avatar;
              updateUser(newUserData, dispatch);
              setIsOpenUpdateDialog(false);
            }}
          >
            <Trans i18nKey="settings.favoriteupdate">Update profile settings</Trans>
          </Button>
          <Button
            onClick={() => {
              setUserSelfDetails(userSelfDetails);
            }}
            size="sm"
          >
            <Trans i18nKey="settings.nextcloudcancel">Cancel</Trans>
          </Button>
        </Group>
      </Dialog>
    </Stack>
  );
};
