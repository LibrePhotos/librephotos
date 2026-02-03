import { Button, Flex } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { TopMenuLogo } from "./TopMenuLogo";

export function TopMenuPublic() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <Flex justify="space-between" align="center" m="xs">
      <TopMenuLogo />
      <Button size="xs" variant="subtle" color="green" onClick={() => navigate({ to: "/login" })}>
        {t("login.login")}
      </Button>
    </Flex>
  );
}
