import { Group, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "../common/Logo";
import { FloatingCard } from "../common/surfaces/FloatingCard";
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
      <FloatingCard className={classes.card}>
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
      </FloatingCard>
      <Text c="dimmed" size="sm" ta="center">
        {t("login.tagline")}
      </Text>
    </Stack>
  );
}
