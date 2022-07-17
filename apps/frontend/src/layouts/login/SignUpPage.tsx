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
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";
import { Lock, Mail, User } from "tabler-icons-react";

import { useSignUpMutation } from "../../api_client/api";

export function SignupPage(): JSX.Element {
  const { t } = useTranslation();
  const history = useHistory();
  const form = useForm({
    initialValues: {
      username: "",
      password: "",
      firstname: "",
      lastname: "",
      passwordConfirm: "",
      email: "",
    },

    validate: {
      passwordConfirm: (value, values) => (value !== values.password ? "Passwords did not match" : null),
    },
  });
  const [signup, { isSuccess, isLoading }] = useSignUpMutation();

  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";

  useEffect(() => {
    if (isSuccess) {
      history.push("/");
    }
  }, [history, isSuccess]);

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
              <Title order={3}>{t("login.signup")}</Title>
              <form
                onSubmit={form.onSubmit(values => {
                  const { email, firstname, lastname, username, password } = values;
                  void signup({ email, firstname, lastname, username, password, is_superuser: false });
                })}
              >
                <Stack>
                  <TextInput
                    required
                    icon={<User />}
                    placeholder={t("login.usernameplaceholder")}
                    name="username"
                    {...form.getInputProps("username")}
                  />
                  <TextInput
                    required
                    icon={<Mail />}
                    placeholder={t("settings.emailplaceholder")}
                    name="email"
                    {...form.getInputProps("email")}
                  />
                  <TextInput
                    required
                    icon={<User />}
                    placeholder={t("settings.firstnameplaceholder")}
                    name="firstname"
                    {...form.getInputProps("firstname")}
                  />
                  <TextInput
                    required
                    icon={<User />}
                    placeholder={t("settings.lastnameplaceholder")}
                    name="firstname"
                    {...form.getInputProps("lastname")}
                  />
                  <PasswordInput
                    icon={<Lock />}
                    placeholder={t("login.passwordplaceholder")}
                    name="password"
                    {...form.getInputProps("password")}
                  />
                  <PasswordInput
                    required
                    icon={<Lock />}
                    placeholder={t("login.confirmpasswordplaceholder")}
                    name="passwordConfirm"
                    {...form.getInputProps("passwordConfirm")}
                  />

                  <Button variant="gradient" gradient={{ from: "#D38312", to: "#A83279" }} type="submit">
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
