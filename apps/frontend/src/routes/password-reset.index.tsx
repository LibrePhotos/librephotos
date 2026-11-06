import { Anchor, Button, Stack, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { createFileRoute } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRequestPasswordResetMutation } from "../api_client/auth";
import { passwordResetError } from "../api_client/auth/passwordResetErrors";
import { AuthCard } from "../components/auth/AuthCard";
import { notification } from "../service/notifications";
import { makePasswordResetRequestSchema } from "./-passwordReset.schema";

export const Route = createFileRoute("/password-reset/")({
  component: PasswordResetRequestPage,
});

function PasswordResetRequestPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { mutate: requestReset, isPending } = useRequestPasswordResetMutation({ reportsErrors: true });
  const [submitted, setSubmitted] = useState(false);

  const form = useForm({
    initialValues: { email: "" },
    validate: schemaResolver(makePasswordResetRequestSchema(t), { sync: true }),
  });

  function onSubmit({ email }: typeof form.values): void {
    requestReset(
      { email },
      {
        // The endpoint always returns 200 (it never reveals whether the address
        // is registered), so show the same confirmation regardless.
        onSuccess: () => setSubmitted(true),
        // A throttled request (5 an hour) used to leave the form as it was,
        // with nothing said.
        onError: error => {
          const reason = passwordResetError(error);
          if (reason.kind === "reported") {
            return;
          }
          notification.error(
            t(reason.kind === "throttled" ? "passwordreset.errorthrottled" : "passwordreset.errorgeneric")
          );
        },
      }
    );
  }

  const backToSignIn = <Anchor href="/login">{t("passwordreset.backtologin")}</Anchor>;

  return (
    <AuthCard
      title={t("passwordreset.title")}
      description={t(submitted ? "passwordreset.checkemail" : "passwordreset.instructions")}
      links={backToSignIn}
    >
      {submitted ? null : (
        <form onSubmit={form.onSubmit(onSubmit)}>
          <Stack>
            <TextInput
              required
              label={t("passwordreset.emailplaceholder")}
              name="email"
              {...form.getInputProps("email")}
            />
            <Button loading={isPending} type="submit" fullWidth>
              {t("passwordreset.sendlink")}
            </Button>
          </Stack>
        </form>
      )}
    </AuthCard>
  );
}
