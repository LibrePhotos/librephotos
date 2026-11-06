import { Card, Group, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "../common/Logo";
import classes from "./AuthCard.module.css";

type Props = Readonly<{
  /** The form's heading, without the product name the logo already shows ("Sign in", "Reset your password"). */
  title: ReactNode;
  /** An optional dimmed line under the heading ("Create the admin account for this server."). */
  description?: ReactNode;
  children: ReactNode;
  /** The quiet links under the form ("Forgot password?", "Back to sign in"), centred in one row. */
  links?: ReactNode;
  /** Above the heading, inside the card (first-time setup's steps). */
  top?: ReactNode;
}>;

/**
 * The layout of every page before the app: sign-in, sign-up, password reset and first-time setup.
 * The logo and the product name above one 400px borderless card with a soft shadow, in the middle of
 * a plain page; inside it the heading, an optional description, the form with its labels above the
 * fields and a full-width primary (AuthCard.module.css sizes them), then a row of small links, as
 * Immich and Google draw their sign-in. The tagline sits under the card on every one of these pages.
 */
export function AuthCard({ title, description, children, links, top }: Props) {
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
      <Card radius={16} className={classes.card}>
        <Stack gap="lg">
          {top}
          <Stack gap={6} align="center">
            <Title order={2} className={classes.title}>
              {title}
            </Title>
            {description ? <Text className={classes.description}>{description}</Text> : null}
          </Stack>
          {children}
          {links ? (
            <Group justify="center" gap="lg" className={classes.links}>
              {links}
            </Group>
          ) : null}
        </Stack>
      </Card>
      <Text c="dimmed" size="sm" ta="center">
        {t("login.tagline")}
      </Text>
    </Stack>
  );
}
