import { PublicSharingDefaults } from "@librephotos/api-client";
import { Anchor, Badge, Card, Group, Stack, Switch, Text, Title } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import type { ParseKeys } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { SectionLink } from "./SettingsSection";
import type { UserSettingsCardProps } from "./userSettingsCard";

type Row = Readonly<{ label: ParseKeys; shown: boolean | "always" }>;

/** What visitors of the gallery see of my photos, from my public sharing switches. */
function galleryRows(defaults: PublicSharingDefaults): Row[] {
  return [
    { label: "settings.galleryShowsPhotos", shown: "always" },
    { label: "settings.galleryShowsName", shown: "always" },
    { label: "settings.galleryShowsDates", shown: defaults.share_timestamps },
    { label: "settings.galleryShowsTowns", shown: defaults.share_location },
    { label: "settings.galleryShowsPeople", shown: defaults.share_faces },
    { label: "settings.galleryShowsCamera", shown: defaults.share_camera_info },
    { label: "settings.galleryShowsCaptions", shown: defaults.share_captions },
  ];
}

function RowBadge({ shown }: Pick<Row, "shown">) {
  const { t } = useTranslation();
  if (shown === "always") {
    return (
      <Badge variant="light" color="gray" size="sm">
        {t("settings.galleryAlways")}
      </Badge>
    );
  }
  return (
    <Badge variant="light" color={shown ? "green" : "gray"} size="sm">
      {shown ? t("settings.galleryShown") : t("settings.galleryHidden")}
    </Badge>
  );
}

/**
 * Taking part in the public gallery (#434): off until the user turns it on. Next to the switch, what
 * visitors see of the user's photos there, from the Public Sharing Defaults below as they stand
 * (unsaved changes included). Shown only while the admin has the gallery open.
 */
export function PublicGalleryCard({ user, onChange }: UserSettingsCardProps) {
  const { t } = useTranslation();
  const { data: settings } = useGetSettingsQuery();
  const stage = settings?.public_gallery;
  if (stage === undefined || stage === "off") return null;
  const defaults = user.public_sharing_defaults ?? PublicSharingDefaults.parse({});

  return (
    <Card shadow="md">
      <Stack>
        <Title order={4}>
          {t("settings.galleryTitle")}
          <SectionLink />
        </Title>
        <Text size="sm" c="dimmed">
          {t(stage === "members" ? "settings.galleryMembersDescription" : "settings.galleryDescription")}{" "}
          <Anchor component={Link} to="/public" size="sm">
            {t("gallery.open")}
          </Anchor>
        </Text>
        <Switch
          label={t("settings.galleryOptIn")}
          description={t("settings.galleryOptInDescription")}
          checked={user.in_public_gallery ?? false}
          onChange={event => onChange({ in_public_gallery: event.currentTarget.checked })}
        />
        <Stack gap={6}>
          <Text fw={500} size="sm">
            {t("settings.galleryPreviewTitle")}
          </Text>
          {galleryRows(defaults).map(row => (
            <Group key={row.label} justify="space-between" wrap="nowrap" gap="xs">
              <Text size="sm">{t(row.label)}</Text>
              <RowBadge shown={row.shown} />
            </Group>
          ))}
          <Text size="xs" c="dimmed">
            {t("settings.galleryNever")}
          </Text>
          {!defaults.share_timestamps && (
            <Text size="xs" c="dimmed">
              {t("settings.galleryUndated")}
            </Text>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
