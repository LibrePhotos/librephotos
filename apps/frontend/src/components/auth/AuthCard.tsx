import { Card, Group, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "../common/Logo";
import classes from "./AuthCard.module.css";

type Props = Readonly<{
  /** The form's heading ("Sign in to LibrePhotos", "Sign up"). */
  title: ReactNode;
  /** A dimmed line under the heading ("Create the admin account for this server."). */
  subtitle?: ReactNode;
  children: ReactNode;
  /** A line under the card (the login page's tagline). */
  footer?: ReactNode;
  /** Above the heading, inside the card (first-time setup's steps). */
  top?: ReactNode;
  /** First-time setup: a 480px card for its steps instead of 400px. */
  wide?: boolean;
}>;

/**
 * The layout of every page before the app: sign-in, sign-up, password reset and first-time setup.
 * The logo and the product name above a borderless card with a soft shadow, in the middle of a
 * plain page; the form's heading inside the card, then the form with its labels above the fields
 * (AuthCard.module.css sizes them), as Immich and Google draw their sign-in.
 */
export function AuthCard({ title, subtitle, children, footer, top, wide = false }: Props) {
  const { t } = useTranslation();
  return (
    <Stack align="center" justify="center" gap="lg" className={classes.page}>
      <Group gap="xs" justify="center" wrap="nowrap">
        {/* Decorative: the name is written right next to it */}
        <Logo size={36} />
        <Text component="span" className={classes.brand}>
          {t("login.name")}
        </Text>
      </Group>
      <Card radius={16} padding={24} className={classes.card} data-wide={wide || undefined}>
        <Stack gap="lg">
          {top}
          <Stack gap={4} align="center">
            <Title order={3} className={classes.title}>
              {title}
            </Title>
            {subtitle ? (
              <Text size="sm" c="dimmed" ta="center">
                {subtitle}
              </Text>
            ) : null}
          </Stack>
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
