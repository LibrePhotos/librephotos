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
  useMantineColorScheme,
} from "@mantine/core";
import { IconPhoto as Photo, IconUpload as Upload, IconUser as User } from "@tabler/icons-react";
import _ from "lodash";
import React, { useEffect, useRef, useState } from "react";
import AvatarEditor from "react-avatar-editor";
import type { DropzoneRef } from "react-dropzone";
import Dropzone from "react-dropzone";
import { Trans, useTranslation } from "react-i18next";

import { updateAvatar, updateUser } from "../../actions/utilActions";
import { api } from "../../api_client/api";
import { serverAddress } from "../../api_client/apiClient";
import { PasswordEntry } from "../../components/settings/PasswordEntry";
import { useAppDispatch, useAppSelector } from "../../store/store";

export function Profile() {
  const [isOpenUpdateDialog, setIsOpenUpdateDialog] = useState(false);
  const [avatarImgSrc, setAvatarImgSrc] = useState("/unknown_user.jpg");
  const [userSelfDetails, setUserSelfDetails] = useState({} as any);
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const userSelfDetailsRedux = useAppSelector(state => state.user.userSelfDetails);
  const { t, i18n } = useTranslation();

  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";
  let editorRef = useRef(null);

  const setEditorRef = ref => {
    editorRef = ref;
  };

  let dropzoneRef = React.useRef<DropzoneRef>();

  const urlToFile = (url, filename, mimeType) => {
    const type = mimeType || (url.match(/^data:([^;]+);/) || "")[1];
    return fetch(url)
      .then(res => res.arrayBuffer())
      .then(buf => new File([buf], filename, { type }));
  };

  const onPasswordValidate = (pass: string, valid: boolean) => {
    const newUserDetails = { ...userSelfDetails };
    if (pass && valid) {
      newUserDetails.password = pass;
    } else {
      delete newUserDetails.password;
    }

    setUserSelfDetails({ ...newUserDetails });
  };

  // open update dialog, when user was edited
  useEffect(() => {
    if (!_.isEqual(userSelfDetailsRedux, userSelfDetails)) {
      setIsOpenUpdateDialog(true);
    } else {
      setIsOpenUpdateDialog(false);
    }
  }, [userSelfDetailsRedux, userSelfDetails]);

  useEffect(() => {
    dispatch(api.endpoints.fetchUserSelfDetails.initiate(auth.access.user_id)).refetch();
  }, [auth.access.user_id, dispatch]);

  useEffect(() => {
    setUserSelfDetails(userSelfDetailsRedux);
  }, [userSelfDetailsRedux]);

  if (avatarImgSrc === "/unknown_user.jpg") {
    if (userSelfDetails.avatar_url) {
      setAvatarImgSrc(serverAddress + userSelfDetails.avatar_url);
    }
  }
  return (
    <Container>
      <Group spacing="xs" sx={{ marginBottom: 20, marginTop: 40 }}>
        <User size={35} />
        <Title order={1}>{t("settings.profile")}</Title>
      </Group>
      <Stack>
        <Card shadow="md">
          <Title order={4} mb={10}>
            User
          </Title>
          <Title order={5}>{t("settings.avatar")}</Title>
          <Group position="center" align="self-start" grow mb="lg">
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
                  // eslint-disable-next-line react/jsx-props-no-spreading
                  <div {...getRootProps()}>
                    {/* eslint-disable-next-line react/jsx-props-no-spreading */}
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
                  onClick={() => {
                    const formData = new FormData();
                    // @ts-ignore
                    urlToFile(
                      // @ts-ignore
                      editorRef.getImageScaledToCanvas().toDataURL(),
                      `${userSelfDetails.first_name}avatar.png`
                    ).then(file => {
                      formData.append("avatar", file, `${userSelfDetails.first_name}avatar.png`);
                      dispatch(updateAvatar(userSelfDetails, formData));
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
          <Title order={5}>{t("settings.account")}</Title>
          <Group grow>
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
            <TextInput
              label={t("settings.email")}
              placeholder={t("settings.emailplaceholder")}
              value={userSelfDetails.email}
              onChange={event => {
                setUserSelfDetails({ ...userSelfDetails, email: event.currentTarget.value });
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
            label={t("settings.thumbnailsize")}
            value={userSelfDetails.image_scale?.toString()}
            onChange={value => {
              setUserSelfDetails({ ...userSelfDetails, image_scale: value });
            }}
            mb={10}
          >
            <Group mt="xs">
              <Radio value="2" label={t("settings.small")} />
              <Radio value="1" label={t("settings.big")} />
            </Group>
          </Radio.Group>

          <Radio.Group
            label={t("settings.public_sharing")}
            value={userSelfDetails.public_sharing ? "1" : "0"}
            onChange={value => {
              setUserSelfDetails({ ...userSelfDetails, public_sharing: !!parseInt(value, 10) });
            }}
            mb={10}
          >
            <Group mt="xs">
              <Radio value="1" label={t("enabled")} />
              <Radio value="0" label={t("disabled")} />
            </Group>
          </Radio.Group>

          <Stack align="flex-start">
            {auth.isAdmin ? (
              <TextInput
                type="text"
                label={t("settings.scandirectory")}
                disabled
                placeholder={userSelfDetails.scan_directory}
              />
            ) : null}

            <Radio.Group
              label={t("settings.colorscheme.title")}
              value={dark ? "1" : "0"}
              onChange={() => {
                toggleColorScheme();
              }}
            >
              <Group mt="xs">
                <Radio value="1" label={t("settings.colorscheme.dark")} />
                <Radio value="0" label={t("settings.colorscheme.light")} />
              </Group>
            </Radio.Group>
          </Stack>

          <Group align="end" mb={10} mt={10}>
            <Select
              withinPortal
              label={t("settings.language")}
              placeholder={t("settings.language")}
              // @ts-ignore
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
    </Container>
  );
}
