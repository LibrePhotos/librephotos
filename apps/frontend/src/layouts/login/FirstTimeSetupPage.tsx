/* eslint-disable react/jsx-props-no-spreading */
import {
  Button,
  Card,
  Group,
  Image,
  PasswordInput,
  Stack,
  TextInput,
  Title,
  useMantineColorScheme,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconLock as Lock, IconMail as Mail, IconUser as User } from "@tabler/icons-react";
import React, { useEffect } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, useSignUpMutation } from "../../api_client/api";
import { useAppDispatch } from "../../store/store";
import { EMAIL_REGEX } from "../../util/util";
import type { ISignUpFormState } from "./loginUtils";

export const initialFormState: ISignUpFormState = {
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
  const [signup, { isLoading, isSuccess }] = useSignUpMutation();
  const dispatch = useAppDispatch();

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

  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";

  useEffect(() => {
    if (isSuccess) {
      dispatch(api.endpoints.fetchUserList.initiate());
      navigate("/");
    }
  }, [navigate, isSuccess, dispatch]);

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
        <Group>
          <Image height={80} width={80} fit="contain" src={dark ? "/logo-white.png" : "/logo.png"} />
          <span style={{ paddingLeft: 5, fontSize: 18 }}>
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
                    disabled={isLoading}
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
