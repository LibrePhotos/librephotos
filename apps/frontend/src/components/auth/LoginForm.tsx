import { Button, Divider, PasswordInput, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { Navigate } from "@tanstack/react-router";
import React from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useIsAuthenticatedQuery, useLoginMutation, useSsoConfigQuery } from "../../api_client/auth";
import { useGetSettingsQuery } from "../../api_client/settings";
import { AuthCard } from "./AuthCard";
import { RememberMeRow } from "./RememberMeRow";
import { SsoErrorAlert } from "./SsoErrorAlert";

type LoginFormProps = {
  /** Back to the page that sent the visitor here; already checked by the route's validateSearch. */
  redirect?: string;
};

export function LoginForm({ redirect }: LoginFormProps): React.JSX.Element {
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
      rememberMe: false,
    },
  });
  // An older server sends no day count and has no "Remember me".
  const rememberMeDays = siteSettings?.remember_me_days ?? 0;

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    login({
      username: form.values.username.toLowerCase(),
      password: form.values.password,
      // Only where the server offers it, so the body stays as it was elsewhere.
      ...(rememberMeDays > 0 ? { remember_me: form.values.rememberMe } : {}),
    });
  }

  if (isAuthenticated) {
    // href carries the target with its own query string and replaces `to` when
    // the location is built; `to="."` is only there because Navigate's types
    // require a `to`.
    return <Navigate to="." href={target} replace />;
  }

  return (
    <AuthCard title={t("login.signintitle")} footer={t("login.tagline")}>
      <SsoErrorAlert />

      <form onSubmit={onSubmit}>
        <Stack>
          {/* The autocomplete tokens are what lets a password manager recognize
                    this pair as a sign-in and offer to remember it; without them the
                    browser is left guessing at a form the SPA mounted after load. */}
          <TextInput
            required
            label={t("login.usernameplaceholder")}
            name="username"
            autoComplete="username"
            {...form.getInputProps("username")}
          />
          <PasswordInput
            required
            label={t("login.passwordplaceholder")}
            name="password"
            autoComplete="current-password"
            {...form.getInputProps("password")}
          />
          <RememberMeRow
            rememberMeDays={rememberMeDays}
            rememberMe={form.values.rememberMe}
            onRememberMeChange={checked => form.setFieldValue("rememberMe", checked)}
            showForgotPassword={!!siteSettings?.email_configured}
          />
          <Button type="submit" loading={isLoading}>
            {t("login.signin")}
          </Button>
          {siteSettings && siteSettings.allow_registration && (
            <Button
              disabled={!siteSettings.allow_registration || isLoading}
              component="a"
              href="/signup"
              variant="default"
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
    </AuthCard>
  );
}
