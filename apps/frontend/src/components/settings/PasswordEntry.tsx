import { ActionIcon, Group, PasswordInput, Stack, Text } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { IconLock as Lock, IconLockOpen as LockOpen } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { NewPasswordFields } from "../../util/formSchemas";

type Props = Readonly<{
  /**
   * The form these fields belong to (the admin's user dialog, the Profile page). Its schema adds
   * their rules with `withNewPassword` and `passwordMessages` (PasswordEntry.schema.ts).
   */
  form: UseFormReturnType<NewPasswordFields>;
  /** "Create user": a password is set, so there is no lock. */
  createNew?: boolean;
}>;

/** The new-password fields of a parent form, behind a lock unless a new user is created. */
export function PasswordEntry({ form, createNew = false }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { changePassword } = form.values;
  const unlocked = createNew || changePassword;
  const passwordProps = form.getInputProps("password");
  const confirmProps = form.getInputProps("passwordConfirm");

  // Keeps what is shown true while typing: a "cannot be blank" on screen goes once either field
  // has text, and "must match" follows both fields. "Cannot be blank" first shows when a field is
  // left (or the form is submitted), not the moment the fields unlock or the dialog opens.
  const recheck = () => {
    if (form.errors.password !== undefined) form.validateField("password");
    if (form.getValues().passwordConfirm === "") {
      form.clearFieldError("passwordConfirm");
    } else {
      form.validateField("passwordConfirm");
    }
  };

  return (
    <Stack style={{ display: "flex", alignContent: "stretch" }} gap="xs">
      {createNew ? (
        <Text fw={700}>{t("settings.password.titlesetpassword")}</Text>
      ) : (
        <Group gap="xs" wrap="nowrap">
          <Text fw={700}>{t("settings.password.titlechangepassword")}</Text>
          {/* A real button, so keyboard and screen reader users can unlock the fields too. */}
          <ActionIcon
            title={t("settings.password.tooltipeditbutton")}
            aria-label={t("settings.password.tooltipeditbutton")}
            aria-pressed={changePassword}
            color="blue"
            variant={changePassword ? "outline" : "filled"}
            onClick={() => {
              // Locking again abandons the change: the typed password must not be saved later (#2197).
              form.setFieldValue("password", "");
              form.setFieldValue("passwordConfirm", "");
              form.setFieldValue("changePassword", !changePassword);
            }}
          >
            {changePassword ? <LockOpen size={16} /> : <Lock size={16} />}
          </ActionIcon>
        </Group>
      )}

      <PasswordInput
        leftSection={<Lock />}
        placeholder={t("login.passwordplaceholder")}
        name="password"
        disabled={!unlocked}
        required={changePassword}
        {...passwordProps}
        onChange={event => {
          form.setFieldValue("password", event.currentTarget.value);
          recheck();
        }}
        onBlur={() => form.validateField("password")}
      />
      <PasswordInput
        leftSection={<Lock />}
        placeholder={t("login.confirmpasswordplaceholder")}
        name="passwordConfirm"
        disabled={!unlocked}
        required={changePassword}
        {...confirmProps}
        onChange={event => {
          form.setFieldValue("passwordConfirm", event.currentTarget.value);
          recheck();
        }}
        onBlur={() => form.validateField("password")}
      />
    </Stack>
  );
}
