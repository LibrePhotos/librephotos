import {
  Button,
  Card,
  Container,
  Group,
  Radio,
  Select,
  SimpleGrid,
  Space,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPhoto as Photo, IconUpload as Upload, IconUser as User } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { isEqual } from "lodash-es";
import React, { useEffect, useRef, useState } from "react";
import type { AvatarEditorRef } from "react-avatar-editor";
import AvatarEditor from "react-avatar-editor";
import type { DropzoneRef } from "react-dropzone";
import Dropzone from "react-dropzone";
import { Trans, useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import { useAccessToken } from "../../api_client/auth/hooks";
import {
  useFetchUserSelfDetailsQuery,
  useUpdateAvatarMutation,
  useUpdateUserMutation,
} from "../../api_client/user/hooks";
import { userKeys } from "../../api_client/user/keys";
import { SIGN_IN_GRADIENT } from "../../theme/brandGradients";
import { reportUserSaveError } from "../../util/apiErrors";
import { PageHeader } from "../PageHeader";
import { PasswordEntry } from "./PasswordEntry";
import { SaveChangesDialog } from "./SaveChangesDialog";

export function Profile() {
  const [isOpenUpdateDialog, { open: openUpdateDialog, close: closeUpdateDialog }] = useDisclosure(false);
  const [avatarImgSrc, setAvatarImgSrc] = useState("/unknown_user.jpg");
  const { data: auth } = useAccessToken();
  const { data: userSelfDetails } = useFetchUserSelfDetailsQuery(auth?.access?.user_id ?? "");
  const [editedUserDetails, setEditedUserDetails] = useState(userSelfDetails);
  const { t, i18n } = useTranslation();
  const updateAvatar = useUpdateAvatarMutation();
  const updateUser = useUpdateUserMutation();
  const editorRef = useRef<AvatarEditorRef>(null);
  const queryClient = useQueryClient();
  const dropzoneRef = useRef<DropzoneRef>(null);

  const urlToFile = async (url: string, filename: string, mimeType?: string) => {
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
    if (!isEqual(userSelfDetails, editedUserDetails)) {
      openUpdateDialog();
    } else {
      closeUpdateDialog();
    }
  }, [userSelfDetails, editedUserDetails, openUpdateDialog, closeUpdateDialog]);

  useEffect(() => {
    if (auth?.access?.user_id) {
      queryClient.invalidateQueries({ queryKey: userKeys.selfDetails() });
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
      <PageHeader icon={User} title={t("settings.profile")} />
      <Stack>
        <Card shadow="md">
          <Title order={4} mb={10}>
            {t("settings.user")}
          </Title>
          <Title order={5}>{t("settings.avatar")}</Title>
          <Group align="flex-start" gap="xl" mb="lg">
            <div>
              <Dropzone
                noClick
                ref={dropzoneRef}
                onDrop={accepted => {
                  const [avatarFile] = accepted;
                  if (avatarFile) setAvatarImgSrc(URL.createObjectURL(avatarFile));
                }}
              >
                {({ getRootProps, getInputProps }) => (
                  <div {...getRootProps()}>
                    <input {...getInputProps()} />
                    <AvatarEditor ref={editorRef} width={150} height={150} border={0} image={avatarImgSrc} />
                  </div>
                )}
              </Dropzone>
            </div>
            <div>
              <Title order={4} mb={10}>
                <Trans i18nKey="settings.uploadheader" />
              </Title>
              <Group>
                <Button
                  size="sm"
                  leftSection={<Photo size={16} />}
                  onClick={() => {
                    dropzoneRef.current?.open();
                  }}
                >
                  <Trans i18nKey="settings.image" />
                </Button>
                <Button
                  size="sm"
                  color="green"
                  leftSection={<Upload size={16} />}
                  onClick={async () => {
                    const editor = editorRef.current;
                    if (!editor) return;
                    const formData = new FormData();
                    const file = await urlToFile(
                      editor.getImageScaledToCanvas().toDataURL(),
                      `${editedUserDetails.first_name}avatar.png`
                    );
                    formData.append("avatar", file, `${editedUserDetails.first_name}avatar.png`);
                    updateAvatar.mutate({ id: editedUserDetails.id.toString(), data: formData });
                  }}
                >
                  <Trans i18nKey="settings.upload" />
                </Button>
              </Group>
              <p>
                <Trans i18nKey="settings.filesize" />
              </p>
            </div>
          </Group>
          <Title order={5}>{t("settings.account")}</Title>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
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
          </SimpleGrid>
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
              <Radio value="1" label={t("settings.on")} />
              <Radio value="0" label={t("settings.off")} />
            </Group>
          </Radio.Group>

          <Stack justify="flex-start">
            {auth?.access?.is_admin ? (
              <TextInput
                type="text"
                label={t("settings.scandirectory")}
                description={t("settings.scandirectoryreadonly")}
                // Filled, so it does not pass for one of the editable fields around it.
                variant="filled"
                readOnly
                value={editedUserDetails.scan_directory ?? ""}
              />
            ) : null}
          </Stack>

          <Group align="end" mb={10} mt={10}>
            <Select
              label={t("settings.language")}
              placeholder={t("settings.language")}
              onChange={value => i18n.changeLanguage(value ?? "en")}
              searchable
              allowDeselect={false}
              maxDropdownHeight={280}
              // The detector stores the browser's code as is ("en-US", "de-DE"), which matches no
              // option; resolvedLanguage is the bundle actually in use ("en", "de", "pt_BR").
              value={i18n.resolvedLanguage ?? "en"}
              data={[
                {
                  value: "en",
                  label: t("settings.english"),
                },
                {
                  value: "ca",
                  label: t("settings.catalan"),
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
                  value: "eo",
                  label: t("settings.esperanto"),
                },
                {
                  value: "et",
                  label: t("settings.estonian"),
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
                  value: "da",
                  label: t("settings.danish"),
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
                  value: "ro",
                  label: t("settings.romanian"),
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
                {
                  value: "ta",
                  label: t("settings.tamil"),
                },
                {
                  value: "tr",
                  label: t("settings.turkish"),
                },
              ]}
            />
            <Button
              component="a"
              href="https://hosted.weblate.org/engage/librephotos/"
              target="_blank"
              variant="gradient"
              gradient={SIGN_IN_GRADIENT}
            >
              {t("settings.helptranslating")}
            </Button>
          </Group>
        </Card>
        <Space h="xl" />
        <SaveChangesDialog
          opened={isOpenUpdateDialog}
          saving={updateUser.isPending}
          onSave={() => {
            const newUserData = { ...editedUserDetails };
            delete newUserData.scan_directory;
            delete newUserData.avatar;
            // Keep the dialog open when the server rejects the save (an invalid email address,
            // for example), so the edits can be fixed.
            updateUser.mutate(newUserData, {
              onSuccess: () => closeUpdateDialog(),
              onError: reportUserSaveError,
            });
          }}
          onCancel={() => {
            setEditedUserDetails(userSelfDetails);
            closeUpdateDialog();
          }}
        />
      </Stack>
    </Container>
  );
}
