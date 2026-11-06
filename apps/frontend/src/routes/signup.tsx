import { Anchor, Button, Stack } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { createFileRoute, Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api_client/api";
import { useLoginMutation, useSignUpMutation } from "../api_client/auth";
import { useGetSettingsQuery } from "../api_client/settings";
import { AuthCard } from "../components/auth/AuthCard";
import { SignupFields } from "../components/auth/SignupFields";
import { notification } from "../service/notifications";
import { reportSignupError } from "../util/apiErrors";
import { makeSignupSchema } from "./-signup.schema";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { data: siteSettings } = useGetSettingsQuery();
  // The login page only hides its Sign Up button; the URL still leads here.
  const registrationClosed = siteSettings?.allow_registration === false;

  const form = useForm({
    initialValues: {
      username: "",
      password: "",
      first_name: "",
      last_name: "",
      passwordConfirm: "",
      email: "",
    },
    validate: schemaResolver(makeSignupSchema(t), { sync: true }),
  });
  const { mutate: signup, isPending: isSignupPending } = useSignUpMutation({ reportsErrors: true });
  // Sign the new user straight in, as first-time setup does: the account
  // exists, and sending them to a login form without a word looked like a failure.
  const { mutate: login, isPending: isLoginPending } = useLoginMutation();

  return (
    <AuthCard
      title={t("login.signuptitle")}
      // Closed sign-ups say so where the description goes, in the same dimmed text as on every other page.
      description={registrationClosed ? t("login.registrationdisabled") : undefined}
      links={
        <Anchor component={Link} to="/login">
          {t("passwordreset.backtologin")}
        </Anchor>
      }
    >
      {registrationClosed ? null : (
        <form
          onSubmit={form.onSubmit(values => {
            const { email, first_name: firstName, last_name: lastName, password } = values;
            const username = values.username.toLowerCase();
            signup(
              { email, first_name: firstName, last_name: lastName, username, password },
              {
                onSuccess: () => login({ username, password }),
                onError: error => {
                  // Registration was turned off after the page loaded: the
                  // server refuses an anonymous sign-up outright.
                  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
                    notification.signupError(t("login.registrationdisabled"));
                    return;
                  }
                  // A taken username or a refused password used to do nothing at all.
                  reportSignupError(error);
                },
              }
            );
          })}
        >
          <Stack>
            <SignupFields form={form} />
            <Button type="submit" fullWidth loading={isSignupPending || isLoginPending}>
              {t("login.createaccount")}
            </Button>
          </Stack>
        </form>
      )}
    </AuthCard>
  );
}
