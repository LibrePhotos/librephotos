import { Anchor, Button, Card, Group, Image, PasswordInput, Stack, Title, useComputedColorScheme } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconLock as Lock } from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useConfirmPasswordResetMutation } from "../api_client/auth";
import { passwordResetError } from "../api_client/auth/passwordResetErrors";
import { notification } from "../service/notifications";
import { SIGN_IN_GRADIENT } from "../theme/brandGradients";
import { makeNewPasswordSchema } from "./-passwordReset.schema";
import classes from "./auth.module.css";

export const Route = createFileRoute("/password-reset/confirm/$uid/$token")({
  component: PasswordResetConfirmPage,
});

function PasswordResetConfirmPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const colorScheme = useComputedColorScheme("dark");
  const { uid, token } = Route.useParams();
  const { mutate: confirmReset, isPending } = useConfirmPasswordResetMutation({ reportsErrors: true });

  const form = useForm({
    initialValues: { password: "", passwordConfirm: "" },
    validate: schemaResolver(makeNewPasswordSchema(t), { sync: true }),
  });

  function onSubmit({ password }: typeof form.values): void {
    confirmReset(
      { uid, token, new_password: password },
      {
        onSuccess: () => {
          notification.success(t("passwordreset.success"));
          navigate({ to: "/login" });
        },
        onError: error => {
          const reason = passwordResetError(error);
          // A password the validators refuse leaves the link usable: say what
          // is wrong at the field instead of sending the user for a new link.
          if (reason.kind === "weakPassword") {
            form.setFieldError("password", reason.message);
            return;
          }
          if (reason.kind === "reported") {
            return;
          }
          notification.error(
            t(reason.kind === "invalidLink" ? "passwordreset.errorinvalidlink" : "passwordreset.errorgeneric")
          );
        },
      }
    );
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
            <Title order={3}>{t("passwordreset.choosetitle")}</Title>
            <form onSubmit={form.onSubmit(onSubmit)}>
              <Stack>
                <PasswordInput
                  required
                  leftSection={<Lock />}
                  placeholder={t("passwordreset.newpasswordplaceholder")}
                  name="password"
                  autoComplete="new-password"
                  {...form.getInputProps("password")}
                />
                <PasswordInput
                  required
                  leftSection={<Lock />}
                  placeholder={t("passwordreset.confirmpasswordplaceholder")}
                  name="passwordConfirm"
                  autoComplete="new-password"
                  {...form.getInputProps("passwordConfirm")}
                />
                <Button loading={isPending} variant="gradient" gradient={SIGN_IN_GRADIENT} type="submit">
                  {t("passwordreset.setpassword")}
                </Button>
                <Anchor href="/login" size="sm" ta="center">
                  {t("passwordreset.backtologin")}
                </Anchor>
              </Stack>
            </form>
          </Stack>
        </Card>
      </div>
    </Stack>
  );
}
