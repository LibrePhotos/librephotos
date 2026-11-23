import { Button, Center, Group, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconClockX } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";

export function UnavailableShareLink({ expired }: Readonly<{ expired: boolean }>) {
  const { t } = useTranslation();
  const Icon = expired ? IconClockX : IconAlertCircle;
  return (
    <Center style={{ minHeight: "60vh" }}>
      <Stack align="center" gap="xs">
        <Icon size={48} />
        <Text fw={600}>{expired ? t("publicphoto.expired") : t("publicphoto.notFound")}</Text>
        <Text c="dimmed" size="sm" ta="center">
          {expired ? t("publicphoto.expiredHint") : t("publicalbum.checkUrl")}
        </Text>
        <Group gap="xs">
          <Button component={Link} to="/" variant="light">
            {t("publicalbum.goHome")}
          </Button>
        </Group>
      </Stack>
    </Center>
  );
}
