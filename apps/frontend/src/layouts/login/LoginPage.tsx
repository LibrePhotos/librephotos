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
  useMantineColorScheme,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import type { FormEvent } from "react";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Lock, User } from "tabler-icons-react";

import { useLoginMutation } from "../../api_client/api";
import { selectIsAuthenticated } from "../../store/auth/authSelectors";
import { authActions } from "../../store/auth/authSlice";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { selectSiteSettings } from "../../store/util/utilSelectors";

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const isAuth = useAppSelector(selectIsAuthenticated);
  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const location = useLocation();
  console.info("location: ", location);
  // @ts-ignore
  const from = location.state?.from || "/";

  const siteSettings = useAppSelector(selectSiteSettings);
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
    void login({ username: form.values.username.toLowerCase(), password: form.values.password });
  }

  if (isAuth) {
    navigate(from);
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
        <Group>
          <Image height={80} width={80} fit="contain" src={dark ? "/logo-white.png" : "/logo.png"} />
          <span style={{ paddingLeft: 5, fontSize: 18 }}>
            <b>{t("login.name")}</b>
          </span>
        </Group>
        <div style={{ width: 500, margin: "auto" }}>
          <Card>
            <Stack>
              <Title order={3}>{t("login.login")}</Title>

              <form onSubmit={onSubmit}>
                <Stack>
                  <TextInput
                    required
                    icon={<User />}
                    placeholder={t("login.usernameplaceholder")}
                    name="username"
                    /* eslint-disable-next-line react/jsx-props-no-spreading */
                    {...form.getInputProps("username")}
                  />
                  <PasswordInput
                    required
                    icon={<Lock />}
                    placeholder={t("login.passwordplaceholder")}
                    name="password"
                    /* eslint-disable-next-line react/jsx-props-no-spreading */
                    {...form.getInputProps("password")}
                  />
                  <Button variant="gradient" gradient={{ from: "#43cea2", to: "#185a9d" }} type="submit">
                    {t("login.login")}
                  </Button>
                  {siteSettings.allow_registration && (
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
    </div>
  );
}
