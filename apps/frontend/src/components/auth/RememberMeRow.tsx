import { Anchor, Checkbox, Group, Stack, Text } from "@mantine/core";
import React, { useId } from "react";
import { useTranslation } from "react-i18next";

type RememberMeRowProps = {
  /** The server's REMEMBER_ME_DAYS; 0 (or an older server, which sends nothing) hides the checkbox. */
  rememberMeDays: number;
  rememberMe: boolean;
  onRememberMeChange: (checked: boolean) => void;
  /** "Forgot your password?" only works when the server can send e-mail. */
  showForgotPassword: boolean;
};

/**
 * The row under the password field: "Remember me" on the left, "Forgot your password?" on the
 * right (#2024, option A of its mockups). It sits inside the password form, above the "or"
 * divider, so it reads as part of the password sign-in: single sign-on keeps session cookies.
 * What the box does is said only while it is ticked, so the default form stays one line.
 */
export function RememberMeRow({
  rememberMeDays,
  rememberMe,
  onRememberMeChange,
  showForgotPassword,
}: RememberMeRowProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const hintId = useId();
  const offered = rememberMeDays > 0;
  if (!offered && !showForgotPassword) {
    return null;
  }
  const showHint = offered && rememberMe;
  return (
    <Stack gap={4}>
      <Group justify="space-between" gap="xs">
        {offered && (
          <Checkbox
            name="remember_me"
            label={t("login.rememberme")}
            checked={rememberMe}
            onChange={event => onRememberMeChange(event.currentTarget.checked)}
            aria-describedby={showHint ? hintId : undefined}
          />
        )}
        {showForgotPassword && (
          <Anchor href="/password-reset" size="sm" ml="auto">
            {t("passwordreset.forgotpassword")}
          </Anchor>
        )}
      </Group>
      {showHint && (
        <Text id={hintId} size="xs" c="dimmed">
          {t("login.remembermehint", { count: rememberMeDays })}
        </Text>
      )}
    </Stack>
  );
}
