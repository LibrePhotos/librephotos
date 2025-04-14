import {
  Button,
  Card,
  Container,
  Dialog,
  Group,
  Radio,
  Select,
  Space,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconPhoto as Photo, IconUpload as Upload, IconUser as User } from "@tabler/icons-react";
import _ from "lodash";
import React, { useEffect, useRef, useState } from "react";
import AvatarEditor from "react-avatar-editor";
import type { DropzoneRef } from "react-dropzone";
import Dropzone from "react-dropzone";
import { Trans, useTranslation } from "react-i18next";

import { serverAddress } from "../../api_client/apiClient";
import { useUpdateAvatarMutation, useUpdateUserMutation, useFetchUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { PasswordEntry } from "../../components/settings/PasswordEntry";
import { useQueryClient } from "@tanstack/react-query"; 
import { useAccessToken } from "../../api_client/auth/hooks";
import { UserSelfDetailsQueryKeys } from "../../api_client/user/hooks/useFetchUserSelfDetailsQuery";  

export function Profile() {
  const [isOpenUpdateDialog, setIsOpenUpdateDialog] = useState(false);
  const [avatarImgSrc, setAvatarImgSrc] = useState("/unknown_user.jpg");
  const { data: auth } = useAccessToken();
  const { data: userSelfDetails } = useFetchUserSelfDetailsQuery(auth?.access?.user_id ?? '');
  const [editedUserDetails, setEditedUserDetails] = useState(userSelfDetails);
  const { t, i18n } = useTranslation();
  const updateAvatar = useUpdateAvatarMutation();
  const updateUser = useUpdateUserMutation(); 
  let editorRef = useRef(null);
  const queryClient = useQueryClient();

  const setEditorRef = ref => {
    editorRef = ref;
  };

  let dropzoneRef = React.useRef<DropzoneRef>();

  const urlToFile = async (url: string, filename: string, mimeType = undefined) => {
    const type = mimeType || (url.match(/^data:([^;]+);/) || "")[1];
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    return new File([buf], filename, { type });
  };

  const onPasswordValidate = (pass: string, valid: boolean) => {
    if (!editedUserDetails) return;
    
    const newUserDetails = { ...editedUserDetails };
    if (pass && valid) {
      newUserDetails.password = pass;
    } else {
      delete newUserDetails.password;
    }

    setEditedUserDetails(newUserDetails);
  };

  // open update dialog, when user was edited
  useEffect(() => {
    if (!_.isEqual(userSelfDetails, editedUserDetails)) {
      setIsOpenUpdateDialog(true);
    } else {
      setIsOpenUpdateDialog(false);
    }
  }, [userSelfDetails, editedUserDetails]);

  useEffect(() => {
    if (auth?.access?.user_id) {
      queryClient.invalidateQueries({ queryKey: [...UserSelfDetailsQueryKeys] });
    }
  }, [auth?.access?.user_id, queryClient]);

  useEffect(() => {
    if (userSelfDetails) {
      setEditedUserDetails(userSelfDetails);
    }
  }, [userSelfDetails]);

  useEffect(() => {
    if (avatarImgSrc === "/unknown_user.jpg" && userSelfDetails?.avatar_url) {
      setAvatarImgSrc(serverAddress + userSelfDetails.avatar_url);
    }
  }, [avatarImgSrc, userSelfDetails]);

  if (!userSelfDetails || !editedUserDetails) {
    return null;
  }

  return (
    <Container>
      <Group gap="xs" mt={40} mb={20}>
        <User size={35} />
        <Title order={1}>{t("settings.profile")}</Title>
      </Group>
      <Stack>
        <Card shadow="md">
          <Title order={4} mb={10}>
            User
          </Title>
          <Title order={5}>{t("settings.avatar")}</Title>
          <Group justify="center" align="self-start" grow mb="lg">
            <div>
              <Dropzone
                noClick
                // @ts-ignore
                style={{ width: 150, height: 150, borderRadius: 75 }}
                ref={node => {
                  // @ts-ignore
                  dropzoneRef = node;
                }}
                onDrop={accepted => {
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
            <div>
              <Title order={4} mb={10}>
                <Trans i18nKey="settings.uploadheader">Upload new avatar</Trans>
              </Title>
              <Group>
                <Button
                  size="sm"
                  onClick={() => {
                    // @ts-ignore
                    dropzoneRef.open();
                  }}
                >
                  <Photo />
                  <Trans i18nKey="settings.image">Choose image</Trans>
                </Button>
                <Button
                  size="sm"
                  color="green"
                  onClick={async () => {
                    const formData = new FormData();
                    const file = await urlToFile(
                      // @ts-ignore
                      editorRef.getImageScaledToCanvas().toDataURL(),
                      `${editedUserDetails.first_name}avatar.png`
                    );
                    formData.append("avatar", file, `${editedUserDetails.first_name}avatar.png`);
                    updateAvatar.mutate({ id: editedUserDetails.id.toString(), data: formData });
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
          <Title order={5}>{t("settings.account")}</Title>
          <Group grow>
            <TextInput
              onChange={event => {
                setEditedUserDetails({ ...editedUserDetails, first_name: event.currentTarget.value });
              }}
              label={t("settings.firstname")}
              placeholder={t("settings.firstnameplaceholder")}
              value={editedUserDetails.first_name}
            />
            <TextInput
              onChange={event => {
                setEditedUserDetails({ ...editedUserDetails, last_name: event.currentTarget.value });
              }}
              label={t("settings.lastname")}
              placeholder={t("settings.lastnameplaceholder")}
              value={editedUserDetails.last_name}
            />
            <TextInput
              label={t("settings.email")}
              placeholder={t("settings.emailplaceholder")}
              value={editedUserDetails.email}
              onChange={event => {
                setEditedUserDetails({ ...editedUserDetails, email: event.currentTarget.value });
              }}
            />
          </Group>
        </Card>

        <Card shadow="md">
          <Title order={4}>{t("settings.security")}</Title>
          <PasswordEntry onValidate={onPasswordValidate} createNew={false} />
        </Card>

        <Card shadow="md">
          <Title order={4} mb={10}>
            {t("settings.appearance")}
          </Title>

          <Radio.Group
            label={t("settings.public_sharing")}
            value={editedUserDetails.public_sharing ? "1" : "0"}
            onChange={value => {
              setEditedUserDetails({ ...editedUserDetails, public_sharing: !!parseInt(value, 10) });
            }}
            mb={10}
          >
            <Group mt="xs">
              <Radio value="1" label={t("enabled")} />
              <Radio value="0" label={t("disabled")} />
            </Group>
          </Radio.Group>

          <Stack justify="flex-start">
            {auth?.access?.is_admin ? (
              <TextInput
                type="text"
                label={t("settings.scandirectory")}
                disabled
                placeholder={editedUserDetails.scan_directory}
              />
            ) : null}
          </Stack>

          <Group align="end" mb={10} mt={10}>
            <Select
              label={t("settings.language")}
              placeholder={t("settings.language")}
              onChange={value => i18n.changeLanguage(value ?? "en")}
              searchable
              maxDropdownHeight={280}
              value={window.localStorage.i18nextLng === "gb" ? "en" : window.localStorage.i18nextLng}
              data={[
                {
                  value: "en",
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
                  value: "zh_Hant",
                  label: t("settings.traditionalchinese"),
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
                {
                  value: "cs",
                  label: t("settings.czech"),
                },
                {
                  value: "pt",
                  label: t("settings.portuguese"),
                },
                {
                  value: "fi",
                  label: t("settings.finnish"),
                },
                {
                  value: "eu",
                  label: t("settings.basque"),
                },
                {
                  value: "uk",
                  label: t("settings.ukrainian"),
                },
                {
                  value: "vi",
                  label: t("settings.vietnamese"),
                },
                {
                  value: "ar",
                  label: t("settings.arabic"),
                },
                {
                  value: "hu",
                  label: t("settings.hungarian"),
                },
                {
                  value: "ko",
                  label: t("settings.korean"),
                },
                {
                  value: "pt_BR",
                  label: t("settings.portuguesebr"),
                },
                {
                  value: "sk",
                  label: t("settings.slovak"),
                },
                {
                  value: "ur",
                  label: t("settings.urdu"),
                },
                {
                  value: "hi",
                  label: t("settings.hindi"),
                },
              ]}
            />
            <Button
              component="a"
              href="https://hosted.weblate.org/engage/librephotos/"
              target="_blank"
              variant="gradient"
              gradient={{ from: "#43cea2", to: "#185a9d" }}
            >
              {t("settings.helptranslating")}
            </Button>
          </Group>
        </Card>
        <Space h="xl" />
        <Dialog
          opened={isOpenUpdateDialog}
          withCloseButton
          onClose={() => setIsOpenUpdateDialog(false)}
          size="lg"
          radius="md"
        >
          <Text size="sm" style={{ marginBottom: 10 }} fw={500}>
            Save Changes?
          </Text>

          <Group justify="flex-end">
            <Button
              size="sm"
              color="green"
              onClick={() => {
                const newUserData = { ...editedUserDetails };
                delete newUserData.scan_directory;
                delete newUserData.avatar;
                updateUser.mutate(newUserData);
                setIsOpenUpdateDialog(false);
              }}
            >
              <Trans i18nKey="settings.favoriteupdate">Update profile settings</Trans>
            </Button>
            <Button
              onClick={() => {
                setEditedUserDetails(userSelfDetails);
              }}
              size="sm"
            >
              <Trans i18nKey="settings.nextcloudcancel">Cancel</Trans>
            </Button>
          </Group>
        </Dialog>
      </Stack>
    </Container>
  );
}
