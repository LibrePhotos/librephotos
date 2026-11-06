import type { User as UserDetails } from "@librephotos/api-client";
import { userKeys } from "@librephotos/api-client";
import { Button, Group, Radio, Select, SimpleGrid, Stack, TextInput, Title } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useEffectEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth/hooks";
import { useFetchUserSelfDetailsQuery, useUpdateUserMutation } from "../../api_client/user/hooks";
import { reportUserSaveError } from "../../util/apiErrors";
import { PageHeader } from "../PageHeader";
import { SettingsPageFrame } from "../SettingsPageFrame";
import { LANGUAGE_OPTIONS } from "./languageOptions";
import { PasswordEntry } from "./PasswordEntry";
import { makeProfileSchema, type ProfileValues } from "./Profile.schema";
import { ProfileAvatar } from "./ProfileAvatar";
import { SaveChangesDialog } from "./SaveChangesDialog";
import { SettingsCard } from "./SettingsCard";

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
  const { data: auth } = useAccessToken();
  const { data: userSelfDetails } = useFetchUserSelfDetailsQuery(auth?.access?.user_id ?? "");
  const { t, i18n } = useTranslation();
  const form = useForm<ProfileValues>({
    // A cached profile shows at once; the effect below follows it when it loads or changes.
    initialValues: valuesOf(userSelfDetails ?? { first_name: "", last_name: "", email: "", public_sharing: false }),
    validate: schemaResolver(makeProfileSchema(t), { sync: true }),
  });
  const updateUser = useUpdateUserMutation({ reportsErrors: true });
  const queryClient = useQueryClient();

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
    <SettingsPageFrame header={<PageHeader title={t("settings.profile")} />}>
      <Stack>
        <SettingsCard>
          {/* One heading per card: the avatar and the name fields are the account */}
          <Title order={4} mb="md">
            {t("settings.account")}
          </Title>
          <ProfileAvatar
            userId={userSelfDetails.id}
            user={{
              username: userSelfDetails.username,
              first_name: form.values.first_name,
              last_name: form.values.last_name,
              avatar_url: userSelfDetails.avatar_url,
            }}
          />
          <SimpleGrid cols={{ base: 1, sm: 3 }} mt="xl">
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
        </SettingsCard>

        <SettingsCard>
          <PasswordEntry form={form} asHeading />
        </SettingsCard>

        <SettingsCard>
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
              description={t("settings.languagedescription")}
              placeholder={t("settings.language")}
              onChange={value => i18n.changeLanguage(value ?? "en")}
              searchable
              allowDeselect={false}
              maxDropdownHeight={280}
              // The detector stores the browser's code as is ("en-US", "de-DE"), which matches no
              // option; resolvedLanguage is the bundle actually in use ("en", "de", "pt_BR").
              value={i18n.resolvedLanguage ?? "en"}
              data={LANGUAGE_OPTIONS.map(({ value, label }) => ({ value, label: t(label) }))}
            />
            <Button
              component="a"
              href="https://hosted.weblate.org/engage/librephotos/"
              target="_blank"
              variant="default"
            >
              {t("settings.helptranslating")}
            </Button>
          </Group>
        </SettingsCard>
        <SaveChangesDialog
          opened={isEdited}
          saving={updateUser.isPending}
          onSave={() => save()}
          // Back to the stored profile, the password fields locked and empty (#2197).
          onCancel={() => form.reset()}
        />
      </Stack>
    </SettingsPageFrame>
  );
}
