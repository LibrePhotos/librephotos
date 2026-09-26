import { Button, Center, Group, Image, Loader, Stack, Text } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import { useFetchSharedPhotoQuery } from "../../api_client/photos/hooks";
import { i18nResolvedLanguage } from "../../i18n";
import { TOP_MENU_HEIGHT } from "../../ui-constants";

export const Route = createFileRoute("/public/p/$slug")({
  component: PublicPhotoBySlug,
});

// Leave room for the public header and a little breathing space around the media.
const MEDIA_MAX_HEIGHT = `calc(100vh - ${TOP_MENU_HEIGHT + 120}px)`;

function captionOf(captions: Record<string, unknown> | undefined): string {
  const userCaption = captions?.user_caption;
  if (typeof userCaption === "string" && userCaption) return userCaption;
  const generated = captions?.im2txt;
  return typeof generated === "string" ? generated : "";
}

/** A single photo shared by a revocable link (issue #2028). */
function PublicPhotoBySlug() {
  const { t } = useTranslation();
  const { slug } = Route.useParams();
  const { data: photo, isLoading, isError } = useFetchSharedPhotoQuery(slug);

  if (isLoading) {
    return (
      <Center style={{ minHeight: "60vh" }}>
        <Loader />
      </Center>
    );
  }

  if (!photo || isError) {
    return (
      <Center style={{ minHeight: "60vh" }}>
        <Stack align="center" gap="xs">
          <IconAlertCircle size={48} />
          <Text fw={600}>{t("publicphoto.notFound")}</Text>
          <Text c="dimmed" size="sm">
            {t("publicalbum.checkUrl")}
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

  const thumbnailUrl = `${serverAddress}${photo.thumbnail_url}`;
  const timestamp = photo.exif_timestamp
    ? DateTime.fromISO(photo.exif_timestamp).setLocale(i18nResolvedLanguage()).toLocaleString(DateTime.DATETIME_MED)
    : "";
  const camera = [photo.camera, photo.lens].filter(Boolean).join(" · ");
  const people = (photo.people ?? []).map(person => person.name).join(", ");
  const caption = captionOf(photo.captions_json);
  const details = [caption, timestamp, photo.search_location, camera, people].filter(Boolean);

  return (
    <Stack align="center" gap="sm" p="md">
      {photo.video_url ? (
        <video
          src={`${serverAddress}${photo.video_url}`}
          poster={thumbnailUrl}
          controls
          playsInline
          style={{ maxWidth: "100%", maxHeight: MEDIA_MAX_HEIGHT }}
        />
      ) : (
        <Image
          src={thumbnailUrl}
          alt={caption || t("publicphoto.title")}
          fit="contain"
          mah={MEDIA_MAX_HEIGHT}
          maw="100%"
          w="auto"
        />
      )}
      {details.map(detail => (
        <Text key={detail} size="sm" c="dimmed" ta="center">
          {detail}
        </Text>
      ))}
    </Stack>
  );
}
