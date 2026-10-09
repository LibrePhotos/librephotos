import {
  Anchor,
  Button,
  Card,
  Group,
  Image,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconLock as Lock, IconMail as Mail, IconUser as User } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api_client/api";
import { useLoginMutation, useSignUpMutation } from "../api_client/auth";
import { useGetSettingsQuery } from "../api_client/settings";
import { notification } from "../service/notifications";
import { reportSignupError } from "../util/apiErrors";
import { EMAIL_REGEX } from "../util/util";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage(): JSX.Element {
  const { t } = useTranslation();
  const colorScheme = useComputedColorScheme("light");
  const { data: siteSettings } = useGetSettingsQuery();
  // The login page only hides its Sign Up button; the URL still leads here.
  const registrationClosed = siteSettings?.allow_registration === false;

  const validateUsername = (username: string) => {
    let error = "";
    if (!username) {
      error = t("modaluseredit.errorusernamecannotbeblank");
    }
    return error || null;
  };
  const form = useForm({
    initialValues: {
      username: "",
      password: "",
      first_name: "",
      last_name: "",
      passwordConfirm: "",
      email: "",
    },

    validate: {
      passwordConfirm: (value, values) => (value !== values.password ? t("settings.password.errormustmatch") : null),
      email: value => (!EMAIL_REGEX.test(value) ? t("modaluseredit.errorinvalidemail") : null),
      username: value => validateUsername(value),
    },
  });
  const { mutate: signup, isPending: isSignupPending } = useSignUpMutation();
  // Sign the new user straight in, as first-time setup does: the account
  // exists, and sending them to a login form without a word looked like a failure.
  const { mutate: login, isPending: isLoginPending } = useLoginMutation();

  return (
    <Stack align="center" justify="flex-end" pt={150}>
      <Group gap="xs" justify="center">
        <Image height={80} width={80} fit="contain" src={colorScheme === "dark" ? "/logo-white.png" : "/logo.png"} />
        <span style={{ fontSize: 18 }}>
          <b>{t("login.name")}</b>
        </span>
      </Group>

      <div className="login-form">
        <Card>
          <Stack>
            <Title order={3}>{t("login.signup")}</Title>
            {registrationClosed ? (
              <Text size="sm">{t("login.registrationdisabled")}</Text>
            ) : (
              <form
                onSubmit={form.onSubmit(values => {
                  const result = form.validate();
                  if (result.hasErrors) {
                    return;
                  }
                  const { email, first_name: firstName, last_name: lastName, password } = values;
                  const username = values.username.toLowerCase();
                  signup(
                    { email, first_name: firstName, last_name: lastName, username, password },
                    {
                      onSuccess: () => login({ username, password }),
                      onError: error => {
                        // Registration was turned off after the page loaded: the
                        // server refuses an anonymous sign-up outright.
                        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
                          notification.signupError(t("login.registrationdisabled"));
                          return;
                        }
                        // A taken username or a refused password used to do nothing at all.
                        reportSignupError(error);
                      },
                    }
                  );
                })}
              >
                <Stack>
                  <TextInput
                    required
                    leftSection={<User />}
                    placeholder={t("login.usernameplaceholder")}
                    name="username"
                    autoComplete="username"
                    {...form.getInputProps("username")}
                  />
                  <TextInput
                    required
                    leftSection={<Mail />}
                    placeholder={t("settings.emailplaceholder")}
                    name="email"
                    autoComplete="email"
                    {...form.getInputProps("email")}
                  />
                  <TextInput
                    required
                    leftSection={<User />}
                    placeholder={t("settings.firstnameplaceholder")}
                    name="firstname"
                    autoComplete="given-name"
                    {...form.getInputProps("first_name")}
                  />
                  <TextInput
                    required
                    leftSection={<User />}
                    placeholder={t("settings.lastnameplaceholder")}
                    name="lastname"
                    autoComplete="family-name"
                    {...form.getInputProps("last_name")}
                  />
                  <PasswordInput
                    required
                    leftSection={<Lock />}
                    placeholder={t("login.passwordplaceholder")}
                    name="password"
                    autoComplete="new-password"
                    {...form.getInputProps("password")}
                  />
                  <PasswordInput
                    required
                    leftSection={<Lock />}
                    placeholder={t("login.confirmpasswordplaceholder")}
                    name="passwordConfirm"
                    autoComplete="new-password"
                    {...form.getInputProps("passwordConfirm")}
                  />

                  <Button
                    variant="gradient"
                    gradient={{ from: "#D38312", to: "#A83279" }}
                    type="submit"
                    loading={isSignupPending || isLoginPending}
                  >
                    {t("login.signup")}
                  </Button>
                </Stack>
              </form>
            )}
            <Anchor component={Link} to="/login" size="sm" ta="center">
              {t("passwordreset.backtologin")}
            </Anchor>
          </Stack>
        </Card>
      </div>
    </Stack>
  );
}
