

import React, { useEffect } from "react";

import { createFileRoute } from '@tanstack/react-router'

import {
  Button,
  Card,
  Center,
  Group,
  Image,
  PasswordInput,
  Stack,
  TextInput,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconLock as Lock, IconMail as Mail, IconUser as User } from "@tabler/icons-react";

import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from '@tanstack/react-query';

import { Navigate } from "@tanstack/react-router";
import { useSignUpMutation } from "../api_client/auth/hooks";
import { EMAIL_REGEX } from "../util/util";
import { UserListQueryKeys } from '../api_client/user/hooks/useFetchUserListQuery';

import { useLoginMutation, useIsAuthenticatedQuery } from "../api_client/auth";
import { useGetSettingsQuery } from "../api_client/settings/hooks/useGetSettingsQuery";
import { useIsFirstTimeSetupQuery } from "../api_client/auth/hooks";
import { isStringEmpty } from "../util/stringUtils";

export const Route = createFileRoute('/login')({
  component: Login,
})

export interface LocationState {
  from: {
    pathname: string;
  };
}

export function Login(): JSX.Element {
  const { data: isFirstTimeSetup, isLoading } = useIsFirstTimeSetupQuery();
  if (!isLoading && isFirstTimeSetup) {
    return (
      <div className="login-page">
        <FirstTimeSetupPage />
      </div>
    );
  }

  return (
    <div className="login-page">
      <LoginPage />
    </div>
  );
}


export function LoginPage(): JSX.Element {
  const colorScheme = useComputedColorScheme("dark");
  const { t } = useTranslation();
  const {data: isAuthenticated} = useIsAuthenticatedQuery();
  const { data: siteSettings } = useGetSettingsQuery();
  const { mutate: login, isPending: isLoading, isSuccess } = useLoginMutation();
  const form = useForm({
    initialValues: {
      username: "",
      password: "",
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    login({ username: form.values.username.toLowerCase(), password: form.values.password });
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

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
            <Title order={3}>{t("login.login")}</Title>

            <form onSubmit={onSubmit}>
              <Stack>
                <TextInput
                  required
                  leftSection={<User />}
                  placeholder={t("login.usernameplaceholder")}
                  name="username"
                  {...form.getInputProps("username")}
                />
                <PasswordInput
                  required
                  leftSection={<Lock />}
                  placeholder={t("login.passwordplaceholder")}
                  name="password"
                  {...form.getInputProps("password")}
                />
                <Button variant="gradient" gradient={{ from: "#43cea2", to: "#185a9d" }} type="submit">
                  {t("login.login")}
                </Button>
                {siteSettings && siteSettings.allow_registration && (
                  <Button
                    disabled={!siteSettings.allow_registration || isLoading}
                    component="a"
                    href="/signup"
                    variant="gradient"
                    gradient={{ from: "#D38312", to: "#A83279" }}
                  >
                    {t("login.signup")}
                  </Button>
                )}
              </Stack>
            </form>
          </Stack>
        </Card>
      </div>
      <Center>{t("login.tagline")}</Center>
    </Stack>
  );
}


export type SignUpForm = {
  username: string;
  password: string;
  firstname: string;
  lastname: string;
  passwordConfirm: string;
  email: string;
}

export type SignInForm = {
  username: string;
  password: string;
}

export function validateSignUpForm(form: SignUpForm): boolean {
  return (
    isStringEmpty(form.username) &&
    isStringEmpty(form.password) &&
    isStringEmpty(form.firstname) &&
    isStringEmpty(form.lastname) &&
    isStringEmpty(form.passwordConfirm) &&
    isStringEmpty(form.email) &&
    form.password === form.passwordConfirm
  );
}

export function validateSignInForm(form: SignInForm): boolean {
  return isStringEmpty(form.username) && isStringEmpty(form.password);
}

export const initialFormState: SignUpForm = {
  username: "",
  password: "",
  firstname: "",
  lastname: "",
  passwordConfirm: "",
  email: "",
};

export function FirstTimeSetupPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {mutate: signup, isPending, isSuccess } = useSignUpMutation();
  const queryClient = useQueryClient();

  const form = useForm({
    initialValues: {
      username: "",
      password: "",
      firstName: "",
      lastName: "",
      passwordConfirm: "",
      email: "",
    },

    validate: {
      passwordConfirm: (value, values) => (value !== values.password ? t("settings.password.errormustmatch") : null),
      email: value => (!EMAIL_REGEX.test(value) ? t("modaluseredit.errorinvalidemail") : null),
    },
  });

  const colorScheme = useComputedColorScheme();
  const dark = colorScheme === "dark";

  useEffect(() => {
    if (isSuccess) {
      queryClient.invalidateQueries({ queryKey: UserListQueryKeys });
      navigate({ to: "/" });
    }
  }, [navigate, isSuccess, queryClient]);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const result = form.validate();
    if (!result.hasErrors) {
      const { email, firstName, lastName, password } = form.values;
      const username = form.values.username.toLowerCase();
      signup({ email, first_name: firstName, last_name: lastName, username, password });
    }
  }

  return (
    <div
      style={{
        paddingTop: 150,
        position: "fixed",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        overflowY: "auto",
        backgroundSize: "cover",
      }}
    >
      <Stack align="center" justify="flex-end">
        <Group gap="xs" justify="center">
          <Image height={80} width={80} fit="contain" src={dark ? "/logo-white.png" : "/logo.png"} />
          <span style={{ fontSize: 18 }}>
            <b>{t("login.name")}</b>
          </span>
        </Group>

        <div className="login-form">
          <Card shadow="xl">
            <Stack>
              <Title order={3}>{t("login.firsttimesetup")}</Title>
              <form onSubmit={onSubmit}>
                <Stack>
                  <TextInput
                    required
                    leftSection={<User />}
                    placeholder={t("login.usernameplaceholder")}
                    name="username"
                    {...form.getInputProps("username")}
                  />
                  <TextInput
                    required
                    leftSection={<Mail />}
                    placeholder={t("settings.emailplaceholder")}
                    name="email"
                    {...form.getInputProps("email")}
                  />
                  <Group grow>
                    <TextInput
                      required
                      leftSection={<User />}
                      placeholder={t("settings.firstnameplaceholder")}
                      name="firstname"
                      {...form.getInputProps("firstName")}
                    />
                    <TextInput
                      required
                      leftSection={<User />}
                      placeholder={t("settings.lastnameplaceholder")}
                      name="firstname"
                      {...form.getInputProps("lastName")}
                    />
                  </Group>
                  <Group grow>
                    <PasswordInput
                      leftSection={<Lock />}
                      placeholder={t("login.passwordplaceholder")}
                      name="password"
                      {...form.getInputProps("password")}
                    />
                    <PasswordInput
                      required
                      leftSection={<Lock />}
                      placeholder={t("login.confirmpasswordplaceholder")}
                      name="passwordConfirm"
                      {...form.getInputProps("passwordConfirm")}
                    />
                  </Group>

                  <Button
                    variant="gradient"
                    gradient={{ from: "#D38312", to: "#A83279" }}
                    type="submit"
                    disabled={isPending}
                  >
                    {t("login.signup")}
                  </Button>
                </Stack>
              </form>
            </Stack>
          </Card>
        </div>
      </Stack>
    </div>
  );
}

