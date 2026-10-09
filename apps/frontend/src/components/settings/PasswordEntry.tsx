import { ActionIcon, Group, PasswordInput, Stack, Text } from "@mantine/core";
import { IconLock as Lock, IconLockOpen as LockOpen } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Props = Readonly<{
  createNew?: boolean;
  /** The password to save ("" for none) and whether the fields allow saving. */
  onValidate: (password: string, isValid: boolean) => void;
  closing?: boolean;
}>;

export function PasswordEntry(props: Props): JSX.Element {
  const { closing = false, createNew = false, onValidate } = props;

  const [editPasswordMode, setEditPasswordMode] = useState(false);
  const { t } = useTranslation();
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [newPasswordError, setNewPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  // "Cannot be blank" waits until the user has left a field or submits, instead of showing in
  // red the moment the fields unlock or the Create User dialog opens.
  const [touched, setTouched] = useState(false);

  const validateAndUpdatePassword = (password: string, passwordConfirm: string, isClosing = false) => {
    setConfirmPasswordError("");
    setNewPasswordError("");
    let validPassword = "";
    let isValid = false;

    if (password || passwordConfirm) {
      if (password === passwordConfirm) {
        validPassword = password;
        isValid = true;
      } else if (passwordConfirm !== "") {
        setConfirmPasswordError(t("settings.password.errormustmatch"));
      } else if (isClosing) {
        setConfirmPasswordError(t("settings.password.errormustretype"));
      }
    } else if (editPasswordMode || createNew) {
      if (isClosing || touched) {
        setNewPasswordError(t("settings.password.errorcannotbeblank"));
      }
    } else {
      isValid = true;
    }

    onValidate(validPassword, isValid);
  };

  // Re-validate when the mode changes; keystrokes validate in the inputs'
  // onChange handlers. The effect reads this render's password values, so they
  // are not stale, just not triggers.
  useEffect(() => {
    validateAndUpdatePassword(newPassword, newPasswordConfirm, closing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createNew, closing, editPasswordMode, touched]);

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
            aria-pressed={editPasswordMode}
            color="blue"
            variant={editPasswordMode ? "outline" : "filled"}
            onClick={() => {
              if (editPasswordMode) {
                setTouched(false);
              }
              setEditPasswordMode(!editPasswordMode);
            }}
          >
            {editPasswordMode ? <LockOpen size={16} /> : <Lock size={16} />}
          </ActionIcon>
        </Group>
      )}

      <PasswordInput
        leftSection={<Lock />}
        placeholder={t("login.passwordplaceholder")}
        name="password"
        disabled={!editPasswordMode && !createNew}
        required={editPasswordMode}
        value={newPassword}
        error={newPasswordError}
        onBlur={() => setTouched(true)}
        onChange={event => {
          setNewPassword(event.currentTarget.value);
          validateAndUpdatePassword(event.currentTarget.value, newPasswordConfirm);
        }}
      />
      <PasswordInput
        leftSection={<Lock />}
        placeholder={t("login.confirmpasswordplaceholder")}
        name="passwordConfirm"
        disabled={!editPasswordMode && !createNew}
        required={editPasswordMode}
        value={newPasswordConfirm}
        error={confirmPasswordError}
        onBlur={() => setTouched(true)}
        onChange={event => {
          setNewPasswordConfirm(event.currentTarget.value);
          validateAndUpdatePassword(newPassword, event.currentTarget.value);
        }}
      />
    </Stack>
  );
}
