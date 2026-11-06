import { Card, Group, Image, Stack, Text, Title, useComputedColorScheme } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import classes from "./AuthCard.module.css";

type Props = Readonly<{
  /** The form's heading ("Login", "Sign up"). */
  title: ReactNode;
  children: ReactNode;
  /** A line under the card (the login page's tagline). */
  footer?: ReactNode;
}>;

/**
 * The card of the sign-in, sign-up and password-reset pages: the logo and the name on top, the
 * form's heading, then the form, centred in the window on the plain page background.
 */
export function AuthCard({ title, children, footer }: Props) {
  const { t } = useTranslation();
  const colorScheme = useComputedColorScheme("light");
  return (
    <Stack align="center" justify="center" className={classes.page}>
      <Card withBorder radius="lg" padding="xl" className={classes.card}>
        <Stack gap="lg">
          <Group gap="sm" justify="center" wrap="nowrap">
            {/* Decorative: the name is written right next to it */}
            <Image h={36} w={36} fit="contain" src={colorScheme === "dark" ? "/logo-white.png" : "/logo.png"} alt="" />
            <Text fw={700} size="xl">
              {t("login.name")}
            </Text>
          </Group>
          <Title order={3} size="h3">
            {title}
          </Title>
          {children}
        </Stack>
      </Card>
      {footer ? (
        <Text c="dimmed" size="sm" ta="center">
          {footer}
        </Text>
      ) : null}
    </Stack>
  );
}
