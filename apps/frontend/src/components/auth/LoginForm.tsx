import {
  Anchor,
  Button,
  Card,
  Center,
  Divider,
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
import { Navigate } from "@tanstack/react-router";
import React from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useIsAuthenticatedQuery, useLoginMutation, useSsoConfigQuery } from "../../api_client/auth";
import { useGetSettingsQuery } from "../../api_client/settings";
import classes from "../../routes/auth.module.css";
import { SIGN_IN_GRADIENT, SIGN_UP_GRADIENT } from "../../theme/brandGradients";
import { SsoErrorAlert } from "./SsoErrorAlert";

type LoginFormProps = {
  /** Back to the page that sent the visitor here; already checked by the route's validateSearch. */
  redirect?: string;
};

export function LoginForm({ redirect }: LoginFormProps): React.JSX.Element {
  const colorScheme = useComputedColorScheme("dark");
  const { t } = useTranslation();
  const { data: isAuthenticated } = useIsAuthenticatedQuery();
  const { data: siteSettings } = useGetSettingsQuery();
  const { data: ssoConfig } = useSsoConfigQuery();
  const target = redirect ?? "/";
  const { mutate: login, isPending: isLoading } = useLoginMutation({ redirectTo: target });
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
    // href carries the target with its own query string and replaces `to` when
    // the location is built; `to="."` is only there because Navigate's types
    // require a `to`.
    return <Navigate to="." href={target} replace />;
  }

  return (
    <Stack align="center" justify="flex-end" pt={150}>
      <Group gap="xs" justify="center">
        {/* Decorative: the name is written right next to it */}
        <Image
          height={80}
          width={80}
          fit="contain"
          src={colorScheme === "dark" ? "/logo-white.png" : "/logo.png"}
          alt=""
        />
        <span style={{ fontSize: 18 }}>
          <b>{t("login.name")}</b>
        </span>
      </Group>
      <div className={classes.loginForm}>
        <Card>
          <Stack>
            <Title order={3}>{t("login.login")}</Title>

            <SsoErrorAlert />

            <form onSubmit={onSubmit}>
              <Stack>
                {/* The autocomplete tokens are what lets a password manager recognize
                    this pair as a sign-in and offer to remember it; without them the
                    browser is left guessing at a form the SPA mounted after load. */}
                <TextInput
                  required
                  leftSection={<User />}
                  placeholder={t("login.usernameplaceholder")}
                  name="username"
                  autoComplete="username"
                  {...form.getInputProps("username")}
                />
                <PasswordInput
                  required
                  leftSection={<Lock />}
                  placeholder={t("login.passwordplaceholder")}
                  name="password"
                  autoComplete="current-password"
                  {...form.getInputProps("password")}
                />
                <Button variant="gradient" gradient={SIGN_IN_GRADIENT} type="submit" loading={isLoading}>
                  {t("login.login")}
                </Button>
                {siteSettings?.email_configured && (
                  <Anchor href="/password-reset" size="sm" ta="center">
                    {t("passwordreset.forgotpassword")}
                  </Anchor>
                )}
                {siteSettings && siteSettings.allow_registration && (
                  <Button
                    disabled={!siteSettings.allow_registration || isLoading}
                    component="a"
                    href="/signup"
                    variant="gradient"
                    gradient={SIGN_UP_GRADIENT}
                  >
                    {t("login.signup")}
                  </Button>
                )}
              </Stack>
            </form>

            {ssoConfig?.enabled && (
              <>
                <Divider label={t("login.sso.divider")} labelPosition="center" />
                <Stack gap="xs">
                  {ssoConfig.providers.map(provider => (
                    // A plain anchor, not a router link: the browser has to leave
                    // the SPA and hit the backend to start the redirect to the IdP.
                    <Button key={provider.id} component="a" href={provider.login_url} variant="default" fullWidth>
                      {/* The configured label reads as one button ("Sign in with
                          Keycloak"); with several providers it stops being
                          descriptive, so name each one instead. */}
                      {ssoConfig.providers.length > 1 ? provider.name : ssoConfig.label || t("login.sso.button")}
                    </Button>
                  ))}
                </Stack>
              </>
            )}
          </Stack>
        </Card>
      </div>
      <Center>{t("login.tagline")}</Center>
    </Stack>
  );
}
