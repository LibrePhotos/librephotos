import { Button, Card, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconWorld } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useGalleryQuery } from "../../api_client/gallery/hooks";

/**
 * On the Sharing overview, while the admin has the public gallery open (#434): the way to it, with
 * how much it shows. Nothing while it is closed (its address answers 404 then).
 */
export function GalleryLinkCard() {
  const { t } = useTranslation();
  const { data: gallery } = useGalleryQuery();
  if (!gallery) return null;
  return (
    <Card shadow="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="sm" wrap="nowrap" miw={0}>
          <ThemeIcon variant="light" size="lg" radius="md" aria-hidden>
            <IconWorld size={20} />
          </ThemeIcon>
          <Stack gap={0} miw={0}>
            <Title order={4}>{t("gallery.cardTitle")}</Title>
            <Text size="sm" c="dimmed">
              {t(gallery.stage === "members" ? "gallery.linkMembers" : "gallery.linkEveryone")}
            </Text>
          </Stack>
        </Group>
        <Button component={Link} to="/public" variant="light">
          {t("gallery.open")}
        </Button>
      </Group>
    </Card>
  );
}
