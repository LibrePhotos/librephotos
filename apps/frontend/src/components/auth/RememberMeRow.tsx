import { Checkbox, Stack, Text } from "@mantine/core";
import React, { useId } from "react";
import { useTranslation } from "react-i18next";

type RememberMeRowProps = {
  /** The server's REMEMBER_ME_DAYS; 0 (or an older server, which sends nothing) hides the checkbox. */
  rememberMeDays: number;
  rememberMe: boolean;
  onRememberMeChange: (checked: boolean) => void;
};

/**
 * The row under the password field: "Remember me" (#2024); "Forgot password?" sits with the other
 * links under the card's button (LoginLinks). It sits inside the password form, above the "or"
 * divider, so it reads as part of the password sign-in: single sign-on keeps session cookies.
 * What the box does is said only while it is ticked, so the default form stays one line.
 */
export function RememberMeRow({
  rememberMeDays,
  rememberMe,
  onRememberMeChange,
}: RememberMeRowProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const hintId = useId();
  const offered = rememberMeDays > 0;
  if (!offered) {
    return null;
  }
  const showHint = offered && rememberMe;
  return (
    <Stack gap={4}>
      <Checkbox
        name="remember_me"
        label={t("login.rememberme")}
        checked={rememberMe}
        onChange={event => onRememberMeChange(event.currentTarget.checked)}
        aria-describedby={showHint ? hintId : undefined}
      />
      {showHint && (
        <Text id={hintId} size="xs" c="dimmed">
          {t("login.remembermehint", { count: rememberMeDays })}
        </Text>
      )}
    </Stack>
  );
}
