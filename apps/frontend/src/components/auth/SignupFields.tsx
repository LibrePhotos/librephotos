import { Group, PasswordInput, TextInput } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import React from "react";
import { useTranslation } from "react-i18next";

export type SignupValues = {
  username: string;
  password: string;
  first_name: string;
  last_name: string;
  passwordConfirm: string;
  email: string;
};

type Props = Readonly<{
  form: UseFormReturnType<SignupValues>;
}>;

/**
 * The fields of a new account, shared by /signup and first-time setup so both lay them out alike:
 * username and email, first and last name side by side, then the password twice.
 */
export function SignupFields({ form }: Props): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <TextInput
        required
        label={t("login.usernameplaceholder")}
        name="username"
        autoComplete="username"
        {...form.getInputProps("username")}
      />
      <TextInput
        required
        label={t("settings.emailplaceholder")}
        name="email"
        autoComplete="email"
        {...form.getInputProps("email")}
      />
      <Group grow gap="sm" align="flex-start">
        <TextInput
          required
          label={t("settings.firstnameplaceholder")}
          name="firstname"
          autoComplete="given-name"
          {...form.getInputProps("first_name")}
        />
        <TextInput
          required
          label={t("settings.lastnameplaceholder")}
          name="lastname"
          autoComplete="family-name"
          {...form.getInputProps("last_name")}
        />
      </Group>
      <PasswordInput
        required
        label={t("login.passwordplaceholder")}
        name="password"
        autoComplete="new-password"
        {...form.getInputProps("password")}
      />
      <PasswordInput
        required
        label={t("login.confirmpasswordplaceholder")}
        name="passwordConfirm"
        autoComplete="new-password"
        {...form.getInputProps("passwordConfirm")}
      />
    </>
  );
}
