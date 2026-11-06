import { Anchor, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

type Props = Readonly<{
  /** The server can send e-mail, so a reset link reaches the user. */
  forgotPassword: boolean;
  /** Sign-ups are open. */
  signup: boolean;
}>;

/**
 * The links under the sign-in button: "Forgot password?" and "No account? Sign up". Plain links,
 * so the one primary on the page stays the Sign in button.
 */
export function LoginLinks({ forgotPassword, signup }: Props): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      {forgotPassword && <Anchor href="/password-reset">{t("passwordreset.forgotpassword")}</Anchor>}
      {signup && (
        <Text component="span" inherit>
          {t("login.noaccount")} <Anchor href="/signup">{t("login.signup")}</Anchor>
        </Text>
      )}
    </>
  );
}
