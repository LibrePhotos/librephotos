import { Button, Center, Group, Stack, Text } from "@mantine/core";
import { IconGlobe as Globe, IconAlertCircle } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePublicAlbumQuery } from "../../api_client/albums/hooks";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PlaySlideshowButton } from "../../components/sharing/PlaySlideshowButton";
import { isUndatedShare, validatePublicAlbumSearch } from "../../components/sharing/publicAlbum";
import { usePublicPageTitle } from "../../components/sharing/usePublicPageTitle";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";

export const Route = createFileRoute("/public/s/$slug")({
  component: PublicAlbumBySlug,
  validateSearch: validatePublicAlbumSearch,
});

function PublicAlbumBySlug() {
  const { t } = useTranslation();
  const { slug } = Route.useParams();
  const slideshow = Route.useSearch({ select: search => search.slideshow });
  const navigate = Route.useNavigate();
  // The flag starts the slideshow; Play sets it and closing drops it, both in place, so Back
  // leaves the album and a reload shows what the visitor last saw.
  const playSlideshow = useCallback(() => void navigate({ search: { slideshow: 1 }, replace: true }), [navigate]);
  const endSlideshow = useCallback(() => void navigate({ search: {}, replace: true }), [navigate]);

  const { data: album, isLoading, isError } = usePublicAlbumQuery(slug);

  const flat = useMemo(() => (album ? getPhotosFlatFromGroupedByDate(album.grouped_photos) : []), [album]);
  usePublicPageTitle(album?.title);

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
      icon={Globe}
      // PhotoListView shows a flat grid when photoset is the idx2hash array
      // itself: no made-up "Without Timestamp" day for hidden dates.
      photoset={album ? (isUndatedShare(album.grouped_photos) ? flat : album.grouped_photos) : []}
      idx2hash={flat}
      isPublic
      publicAlbumSlug={slug}
      selectable
      headerActions={flat.length > 0 ? <PlaySlideshowButton onPlay={playSlideshow} /> : undefined}
      slideshow={slideshow === 1}
      onSlideshowClose={endSlideshow}
    />
  );
}
