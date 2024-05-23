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
import { useLocation, useNavigate } from "react-router-dom";

import { useLoginMutation } from "../../api_client/api";
import { useGetSettingsQuery } from "../../api_client/site-settings";
import { selectIsAuthenticated } from "../../store/auth/authSelectors";
import { authActions } from "../../store/auth/authSlice";
import { useAppDispatch, useAppSelector } from "../../store/store";

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const isAuth = useAppSelector(selectIsAuthenticated);
  const colorScheme = useComputedColorScheme("dark");
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const location = useLocation();
  // @ts-ignore
  const from = location.state?.from || "/";

  const { currentData: siteSettings } = useGetSettingsQuery();
  const [login, { isLoading }] = useLoginMutation();
  const form = useForm({
    initialValues: {
      username: "",
      password: "",
    },
  });

  useEffect(() => {
    dispatch(authActions.clearError());
  }, [dispatch]);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    login({ username: form.values.username.toLowerCase(), password: form.values.password });
  }

  if (isAuth) {
    navigate(from);
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
                  /* eslint-disable-next-line react/jsx-props-no-spreading */
                  {...form.getInputProps("username")}
                />
                <PasswordInput
                  required
                  leftSection={<Lock />}
                  placeholder={t("login.passwordplaceholder")}
                  name="password"
                  /* eslint-disable-next-line react/jsx-props-no-spreading */
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
