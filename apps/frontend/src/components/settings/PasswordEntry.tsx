import { ActionIcon, Group, PasswordInput, Stack, Text, Title } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { IconLock as Lock, IconLockOpen as LockOpen } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { NewPasswordFields } from "../../util/formSchemas";
import { toolbarLook } from "../common/toolbarLook";
import classes from "./PasswordEntry.module.css";

type Props = Readonly<{
  /**
   * The form these fields belong to (the admin's user dialog, the Profile page). Its schema adds
   * their rules with `withNewPassword` and `passwordMessages` (PasswordEntry.schema.ts).
   */
  form: UseFormReturnType<NewPasswordFields>;
  /** "Create user": a password is set, so there is no lock. */
  createNew?: boolean;
  /** The title is its card's heading (the Profile page), not a label inside a dialog. */
  asHeading?: boolean;
}>;

/** The new-password fields of a parent form, behind a lock unless a new user is created. */
export function PasswordEntry({ form, createNew = false, asHeading = false }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { changePassword } = form.values;
  const unlocked = createNew || changePassword;
  const passwordProps = form.getInputProps("password");
  const confirmProps = form.getInputProps("passwordConfirm");
  // Locked fields keep the normal input look: greyed out they read as broken, and the lock button
  // beside the title already says why they cannot be typed in.
  const lockedLook = unlocked ? undefined : { input: classes.locked };

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
    <Stack gap="xs">
      {createNew ? (
        <Text fw={700}>{t("settings.password.titlesetpassword")}</Text>
      ) : (
        <Group gap="xs" wrap="nowrap">
          {asHeading ? (
            <Title order={4}>{t("settings.password.titlechangepassword")}</Title>
          ) : (
            <Text fw={700}>{t("settings.password.titlechangepassword")}</Text>
          )}
          {/* A real button, so keyboard and screen reader users can unlock the fields too. */}
          <ActionIcon
            title={t("settings.password.tooltipeditbutton")}
            aria-label={t("settings.password.tooltipeditbutton")}
            aria-pressed={changePassword}
            {...toolbarLook(changePassword)}
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
        classNames={lockedLook}
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
        classNames={lockedLook}
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
