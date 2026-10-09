import { Button, Flex, Group } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useIsAuthenticatedQuery } from "../../api_client/auth";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { ProfileButton } from "./ProfileButton";
import { TopMenuLogo } from "./TopMenuLogo";

export function TopMenuPublic() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  // Owners open their own share links while signed in: offer the way back to
  // the library and the account menu (with Log out) instead of "Login".
  const { data: isAuthenticated } = useIsAuthenticatedQuery();
  // The "access" cookie outlives an expired session (browser session restore
  // keeps it), so only a user the server still returns counts as signed in.
  const { data: user, isLoading: checkingSession } = useCurrentUserSelfDetailsQuery(!isAuthenticated);

  let actions: React.ReactNode = null;
  if (isAuthenticated && user) {
    actions = (
      <Group gap="xs" wrap="nowrap">
        <Button size="xs" variant="subtle" color="green" onClick={() => navigate({ to: "/" })}>
          {t("publicalbum.goHome")}
        </Button>
        <ProfileButton />
      </Group>
    );
  } else if (!checkingSession) {
    // While the session is being checked show neither, so an owner does not see "Login" flash.
    actions = (
      <Button size="xs" variant="subtle" color="green" onClick={() => navigate({ to: "/login" })}>
        {t("login.login")}
      </Button>
    );
  }

  return (
    <Flex justify="space-between" align="center" h="100%" px="xs">
      <TopMenuLogo />
      {actions}
    </Flex>
  );
}
