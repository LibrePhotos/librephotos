import {
  Anchor,
  Button,
  Card,
  Group,
  Image,
  Stack,
  Text,
  TextInput,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconMail as Mail } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRequestPasswordResetMutation } from "../api_client/auth";
import { EMAIL_REGEX } from "../util/util";

export const Route = createFileRoute("/password-reset/")();

export function PasswordResetRequestPage(): JSX.Element {
  const { t } = useTranslation();
  const colorScheme = useComputedColorScheme("dark");
  const { mutate: requestReset, isPending } = useRequestPasswordResetMutation();
  const [submitted, setSubmitted] = useState(false);

  const form = useForm({
    initialValues: { email: "" },
    validate: {
      email: value => (!EMAIL_REGEX.test(value) ? t("passwordreset.erroremail") : null),
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const { hasErrors } = form.validate();
    if (hasErrors) {
      return;
    }
    requestReset(
      { email: form.values.email },
      {
        // The endpoint always returns 200 (it never reveals whether the address
        // is registered), so show the same confirmation regardless.
        onSuccess: () => setSubmitted(true),
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
            <Title order={3}>{t("passwordreset.title")}</Title>
            {submitted ? (
              <>
                <Text>{t("passwordreset.checkemail")}</Text>
                <Anchor href="/login">{t("passwordreset.backtologin")}</Anchor>
              </>
            ) : (
              <form onSubmit={onSubmit}>
                <Stack>
                  <Text size="sm">{t("passwordreset.instructions")}</Text>
                  <TextInput
                    required
                    leftSection={<Mail />}
                    placeholder={t("passwordreset.emailplaceholder")}
                    name="email"
                    {...form.getInputProps("email")}
                  />
                  <Button
                    loading={isPending}
                    variant="gradient"
                    gradient={{ from: "#43cea2", to: "#185a9d" }}
                    type="submit"
                  >
                    {t("passwordreset.sendlink")}
                  </Button>
                  <Anchor href="/login" size="sm" ta="center">
                    {t("passwordreset.backtologin")}
                  </Anchor>
                </Stack>
              </form>
            )}
          </Stack>
        </Card>
      </div>
    </Stack>
  );
}

Route.update({ component: PasswordResetRequestPage });
