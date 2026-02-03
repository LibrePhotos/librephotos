import { Button, Center, Group, Stack, Text } from "@mantine/core";
import { IconGlobe as Globe, IconAlertCircle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { UserAlbum } from "../../api_client/albums/types";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";
import { parseWithNotification } from "../../util/zodUtils";

export const Route = createFileRoute("/public/s/$slug")();

function PublicAlbumBySlug() {
  const { t } = useTranslation();
  const { slug } = Route.useParams();

  const {
    data: album,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["publicAlbumBySlug", slug],
    retry: false,
    queryFn: async () => {
      const resp = await fetch(`/api/public/albums/s/${slug}/`);
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error("Failed to load public album");
      const json = await resp.json();
      return parseWithNotification(UserAlbum, json.results, "Failed to parse public album");
    },
  });

  const flat = useMemo(() => (album ? getPhotosFlatFromGroupedByDate(album.grouped_photos) : []), [album]);

  if (!isLoading && (album === null || isError)) {
    return (
      <Center style={{ minHeight: "60vh" }}>
        <Stack align="center" gap="xs">
          <IconAlertCircle size={48} />
          <Text fw={600}>{t("publicalbum.notFound")}</Text>
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

  return (
    <PhotoListView
      title={album ? album.title : t("loading")}
      loading={isLoading}
      icon={<Globe size={50} />}
      photoset={album ? album.grouped_photos : []}
      idx2hash={flat}
      isPublic
      publicAlbumSlug={slug}
      selectable
    />
  );
}

Route.update({ component: PublicAlbumBySlug });
