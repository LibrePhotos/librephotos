import { Anchor, Button, Card, Group, Image, PasswordInput, Stack, Title, useComputedColorScheme } from "@mantine/core";
import { useForm } from "@mantine/form";
import { showNotification } from "@mantine/notifications";
import { IconLock as Lock } from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useConfirmPasswordResetMutation } from "../api_client/auth";

export const Route = createFileRoute("/password-reset/confirm/$uid/$token")();

export function PasswordResetConfirmPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const colorScheme = useComputedColorScheme("dark");
  const { uid, token } = Route.useParams();
  const { mutate: confirmReset, isPending } = useConfirmPasswordResetMutation();

  const form = useForm({
    initialValues: { password: "", passwordConfirm: "" },
    validate: {
      passwordConfirm: (value, values) => (value !== values.password ? t("passwordreset.errormustmatch") : null),
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const { hasErrors } = form.validate();
    if (hasErrors) {
      return;
    }
    confirmReset(
      { uid, token, new_password: form.values.password },
      {
        onSuccess: () => {
          showNotification({
            message: t("passwordreset.success"),
            color: "teal",
          });
          navigate({ to: "/login" });
        },
        onError: () => {
          showNotification({
            message: t("passwordreset.errorinvalidlink"),
            color: "red",
          });
        },
      }
    );
  }

  return (
    <Stack align="center" justify="flex-end" pt={150}>
      <Group gap="xs" justify="center">
        <Image height={80} width={80} fit="contain" src={colorScheme === "dark" ? "/logo-white.png" : "/logo.png"} />
        <span style={{ fontSize: 18 }}>
          <b>{t("login.name")}</b>
        </span>
      </Group>
      <div className="login-form">
        <Card>
          <Stack>
            <Title order={3}>{t("passwordreset.choosetitle")}</Title>
            <form onSubmit={onSubmit}>
              <Stack>
                <PasswordInput
                  required
                  leftSection={<Lock />}
                  placeholder={t("passwordreset.newpasswordplaceholder")}
                  name="password"
                  {...form.getInputProps("password")}
                />
                <PasswordInput
                  required
                  leftSection={<Lock />}
                  placeholder={t("passwordreset.confirmpasswordplaceholder")}
                  name="passwordConfirm"
                  {...form.getInputProps("passwordConfirm")}
                />
                <Button
                  loading={isPending}
                  variant="gradient"
                  gradient={{ from: "#43cea2", to: "#185a9d" }}
                  type="submit"
                >
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

Route.update({ component: PasswordResetConfirmPage });
