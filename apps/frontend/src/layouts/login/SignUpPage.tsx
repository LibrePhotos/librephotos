import {
  Button,
  Card,
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
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useSignUpMutation } from "../../api_client/api";
import { EMAIL_REGEX } from "../../util/util";

export function SignupPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const colorScheme = useComputedColorScheme("light");

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
  const [signup, { isSuccess }] = useSignUpMutation();

  useEffect(() => {
    if (isSuccess) {
      navigate("/");
    }
  }, [navigate, isSuccess]);

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
            <Title order={3}>{t("login.signup")}</Title>
            <form
              onSubmit={form.onSubmit(values => {
                const result = form.validate();
                if (result.hasErrors) {
                  return;
                }
                const { email, first_name: firstName, last_name: lastName, password } = values;
                const username = values.username.toLowerCase();
                signup({ email, first_name: firstName, last_name: lastName, username, password });
              })}
            >
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
                <TextInput
                  required
                  leftSection={<User />}
                  placeholder={t("settings.firstnameplaceholder")}
                  name="firstname"
                  {...form.getInputProps("first_name")}
                />
                <TextInput
                  required
                  leftSection={<User />}
                  placeholder={t("settings.lastnameplaceholder")}
                  name="lastname"
                  {...form.getInputProps("last_name")}
                />
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

                <Button variant="gradient" gradient={{ from: "#D38312", to: "#A83279" }} type="submit">
                  {t("login.signup")}
                </Button>
              </Stack>
            </form>
          </Stack>
        </Card>
      </div>
    </Stack>
  );
}
