import type { User as UserDetails } from "@librephotos/api-client";
import { userKeys } from "@librephotos/api-client";
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
import { schemaResolver, useForm } from "@mantine/form";
import { IconPhoto as Photo, IconUpload as Upload, IconUser as User } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useEffectEvent, useRef, useState } from "react";
import type { AvatarEditorRef } from "react-avatar-editor";
import AvatarEditor from "react-avatar-editor";
import type { DropzoneRef } from "react-dropzone";
import Dropzone from "react-dropzone";
import { Trans, useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth/hooks";
import { serverAddress } from "../../api_client/urls";
import {
  useFetchUserSelfDetailsQuery,
  useUpdateAvatarMutation,
  useUpdateUserMutation,
} from "../../api_client/user/hooks";
import { SIGN_IN_GRADIENT } from "../../theme/brandGradients";
import { reportUserSaveError } from "../../util/apiErrors";
import { dataUrlToFile } from "../../util/dataUrl";
import { PageHeader } from "../PageHeader";
import { PasswordEntry } from "./PasswordEntry";
import { makeProfileSchema, type ProfileValues } from "./Profile.schema";
import { SaveChangesDialog } from "./SaveChangesDialog";

/** The profile's form values: the stored details, and the password fields locked and empty. */
const valuesOf = (user: Pick<UserDetails, "first_name" | "last_name" | "email" | "public_sharing">): ProfileValues => ({
  first_name: user.first_name,
  last_name: user.last_name,
  email: user.email,
  public_sharing: user.public_sharing,
  password: "",
  passwordConfirm: "",
  changePassword: false,
});

// The fields an edit is made of: unlocking the password fields alone is not one.
const EDITABLE_FIELDS = ["first_name", "last_name", "email", "public_sharing", "password", "passwordConfirm"] as const;

export function Profile() {
  const [avatarImgSrc, setAvatarImgSrc] = useState("/unknown_user.jpg");
  const { data: auth } = useAccessToken();
  const { data: userSelfDetails } = useFetchUserSelfDetailsQuery(auth?.access?.user_id ?? "");
  const { t, i18n } = useTranslation();
  const form = useForm<ProfileValues>({
    // A cached profile shows at once; the effect below follows it when it loads or changes.
    initialValues: valuesOf(userSelfDetails ?? { first_name: "", last_name: "", email: "", public_sharing: false }),
    validate: schemaResolver(makeProfileSchema(t), { sync: true }),
  });
  const updateAvatar = useUpdateAvatarMutation();
  const updateUser = useUpdateUserMutation({ reportsErrors: true });
  const editorRef = useRef<AvatarEditorRef>(null);
  const queryClient = useQueryClient();
  const dropzoneRef = useRef<DropzoneRef>(null);

  // What the form starts from and what an edit is measured against: the stored profile, or what
  // was just saved.
  const startFrom = (values: ProfileValues) => {
    form.setValues(values);
    form.resetDirty(values);
  };
  // `form` is a new object every render, not a trigger.
  const loadStored = useEffectEvent((user: UserDetails) => startFrom(valuesOf(user)));
  // The "Save changes?" dialog shows while the profile holds an edit.
  const isEdited = EDITABLE_FIELDS.some(field => form.isDirty(field));

  useEffect(() => {
    if (auth?.access?.user_id) {
      queryClient.invalidateQueries({ queryKey: userKeys.selfDetails() });
    }
  }, [auth?.access?.user_id, queryClient]);

  useEffect(() => {
    if (userSelfDetails) {
      loadStored(userSelfDetails);
    }
  }, [userSelfDetails]);

  useEffect(() => {
    if (avatarImgSrc === "/unknown_user.jpg" && userSelfDetails?.avatar_url) {
      setAvatarImgSrc(serverAddress + userSelfDetails.avatar_url);
    }
  }, [avatarImgSrc, userSelfDetails]);

  if (!userSelfDetails) {
    return null;
  }

  const save = form.onSubmit(values => {
    const { password, passwordConfirm: _retyped, changePassword, ...edits } = values;
    const newUserData: Partial<UserDetails> & Pick<UserDetails, "id"> = { ...userSelfDetails, ...edits };
    delete newUserData.scan_directory;
    delete newUserData.avatar;
    // Locked fields hold no password (locking empties them); the schema checked unlocked ones.
    if (changePassword && password) {
      newUserData.password = password;
    }
    // Keep the dialog open when the server rejects the save (an invalid email address,
    // for example), so the edits can be fixed.
    updateUser.mutate(newUserData, {
      onSuccess: () => startFrom({ ...values, password: "", passwordConfirm: "", changePassword: false }),
      onError: reportUserSaveError,
    });
  });

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
              {/* noDragEventsBubbling: an avatar dropped here is not also an upload to the library. */}
              <Dropzone
                noClick
                noDragEventsBubbling
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
                <Button size="sm" leftSection={<Photo size={16} />} onClick={() => dropzoneRef.current?.open()}>
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
                    const file = await dataUrlToFile(
                      editor.getImageScaledToCanvas().toDataURL(),
                      `${form.values.first_name}avatar.png`
                    );
                    formData.append("avatar", file, `${form.values.first_name}avatar.png`);
                    updateAvatar.mutate({ id: userSelfDetails.id.toString(), data: formData });
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
              label={t("settings.firstname")}
              placeholder={t("settings.firstnameplaceholder")}
              {...form.getInputProps("first_name")}
            />
            <TextInput
              label={t("settings.lastname")}
              placeholder={t("settings.lastnameplaceholder")}
              {...form.getInputProps("last_name")}
            />
            <TextInput
              label={t("settings.email")}
              placeholder={t("settings.emailplaceholder")}
              {...form.getInputProps("email")}
            />
          </SimpleGrid>
        </Card>

        <Card shadow="md">
          <Title order={4}>{t("settings.security")}</Title>
          <PasswordEntry form={form} />
        </Card>

        <Card shadow="md">
          <Title order={4} mb={10}>
            {t("settings.appearance")}
          </Title>

          <Radio.Group
            label={t("settings.public_sharing")}
            value={form.values.public_sharing ? "1" : "0"}
            onChange={value => form.setFieldValue("public_sharing", value === "1")}
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
                value={userSelfDetails.scan_directory ?? ""}
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
          opened={isEdited}
          saving={updateUser.isPending}
          onSave={() => save()}
          // Back to the stored profile, the password fields locked and empty (#2197).
          onCancel={() => form.reset()}
        />
      </Stack>
    </Container>
  );
}
