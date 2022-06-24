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
import { useHistory } from "react-router-dom";
import { Lock, User } from "tabler-icons-react";

import { fetchSiteSettings } from "../../actions/utilActions";
import { useLoginMutation } from "../../api_client/api";
import { authActions } from "../../store/auth/authSlice";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { selectSiteSettings } from "../../store/util/utilSelectors";
import { isStringEmpty } from "../../util/stringUtils";

export function LoginPage(): JSX.Element {
  const history = useHistory();

  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";

  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  const siteSettings = useAppSelector(selectSiteSettings);
  const [login, { isSuccess, isLoading }] = useLoginMutation();
  const form = useForm({
    initialValues: {
      username: "",
      password: "",
    },

    validate: {
      password: value => (isStringEmpty(value) ? null : "Password should not be empty"),
      username: value => (isStringEmpty(value) ? null : "Username should not be empty"),
    },
  });

  useEffect(() => {
    dispatch(authActions.clearError());
    fetchSiteSettings(dispatch);
  }, [dispatch]);

  useEffect(() => {
    if (isSuccess) {
      history.push("/");
    }
  }, [history, isSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void login({ username: form.values.username.toLowerCase(), password: form.values.password });
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
          <Image height={80} fit="contain" src={dark ? "/logo-white.png" : "/logo.png"} />
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
                    icon={<User />}
                    label={t("login.username")}
                    placeholder={t("login.usernameplaceholder")}
                    name="username"
                    {...form.getInputProps("username")}
                  />
                  <PasswordInput
                    icon={<Lock />}
                    label={t("login.password")}
                    placeholder={t("login.passwordplaceholder")}
                    name="password"
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
