import { Card, Image, Stack, Text, Title, useComputedColorScheme } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./AuthCard.module.css";

type Props = Readonly<{
  /** The form's heading ("Sign in to LibrePhotos", "Sign Up"). */
  title: ReactNode;
  children: ReactNode;
  /** A line under the card (the login page's tagline). */
  footer?: ReactNode;
}>;

/**
 * The card of the sign-in, sign-up and password-reset pages: the logo, the form's heading centred
 * under it, then the form, on a borderless card with a soft shadow in the middle of the window.
 */
export function AuthCard({ title, children, footer }: Props) {
  const colorScheme = useComputedColorScheme("light");
  return (
    <Stack align="center" justify="center" className={classes.page}>
      <Card radius={16} padding={24} className={classes.card}>
        <Stack gap="lg">
          <Stack gap="sm" align="center">
            {/* Decorative: the heading under it names the app */}
            <Image h={40} w={40} fit="contain" src={colorScheme === "dark" ? "/logo-white.png" : "/logo.png"} alt="" />
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
