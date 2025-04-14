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
import { IconLock as Lock, IconUser as User } from "@tabler/icons-react";
import type { FormEvent } from "react";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useLoginMutation, useIsAuthenticatedQuery } from "../../api_client/auth";
import { useGetSettingsQuery } from "../../api_client/settings/hooks/useGetSettingsQuery";
import { Navigate } from "react-router-dom";
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
      <Group>
        <Image height={80} width={80} fit="contain" src={colorScheme === "dark" ? "/logo-white.png" : "/logo.png"} />
        <span style={{ paddingLeft: 5, fontSize: 18 }}>
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
