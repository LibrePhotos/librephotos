import { Card, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";
import { Logo } from "../common/Logo";
import classes from "./AuthCard.module.css";

type Props = Readonly<{
  /** The form's heading ("Sign in to LibrePhotos", "Sign up"). */
  title: ReactNode;
  children: ReactNode;
  /** A line under the card (the login page's tagline). */
  footer?: ReactNode;
}>;

/**
 * The card of the sign-in, sign-up and password-reset pages: the accent logo, the form's heading
 * centred under it, then the form, on a borderless card with a soft shadow in the middle of the
 * window, over a soft glow of the accent colour.
 */
export function AuthCard({ title, children, footer }: Props) {
  return (
    <Stack align="center" justify="center" className={classes.page}>
      <Card radius={16} padding={24} className={classes.card}>
        <Stack gap="lg">
          <Stack gap="sm" align="center">
            {/* Decorative: the heading under it names the app */}
            <Logo size={40} />
            <Title order={3} className={classes.title}>
              {title}
            </Title>
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
