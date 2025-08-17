import { Button, Group, Image } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "@tanstack/react-router";

export function TopMenuCommon() {
  return (
    <Group visibleFrom="sm" style={{ width: "185px", flexShrink: 0 }}>
      <Link to="/" style={{ padding: 10 }}>
        <Button color="dark" style={{ padding: 2 }}>
          <Image height={30} width={30} src="/logo-white.png" />
        </Button>
      </Link>
    </Group>
  );
}

export function TopMenuPublic() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <Group justify="space-between" px={15} py={10}>
      <Link to="/">
        <Image height={30} width={30} src="/logo-white.png" />
      </Link>
      <Group align="right">
        <Button onClick={() => navigate({ to: "/login" })}>{t("login.login")}</Button>
      </Group>
    </Group>
  );
}
