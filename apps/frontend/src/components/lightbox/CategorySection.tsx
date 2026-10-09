import { Badge, Button, Center, Group, SegmentedControl, Stack, Text, Title } from "@mantine/core";
import { hideNotification, showNotification } from "@mantine/notifications";
import {
  IconFileText as FileText,
  IconInfoCircle as InfoCircle,
  IconPhoto as Photo,
  IconScreenshot as Screenshot,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  photoCategory,
  useSetPhotosCategoryMutation,
  type PhotoCategory,
} from "../../api_client/photos/hooks/useSetPhotosCategoryMutation";
import type { Photo as PhotoType } from "../../api_client/photos/types";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import type { User } from "../../api_client/user/types";
import { useAuth } from "../../hooks/useAuth";
import { savedTimelineFilter, timelineFilterShows } from "../photolist/timelineFilter";

type CategoryState = { category: PhotoCategory; source: "user" | "auto" };

type Props = Readonly<{
  photoDetail: PhotoType;
}>;

const ICONS: Record<PhotoCategory, typeof Photo> = {
  photo: Photo,
  screenshot: Screenshot,
  document: FileText,
};

const ICON_COLORS: Record<PhotoCategory, string> = {
  photo: "var(--mantine-color-blue-6)",
  screenshot: "var(--mantine-color-violet-6)",
  document: "var(--mantine-color-orange-7)",
};

// Where the item shows up, given its category and the user's saved default
// timeline filter (what a bare "/" shows).
function whereKey(state: CategoryState, shownInTimeline: boolean, hidden: boolean) {
  if (hidden) return "lightbox.category.where.hiddenphoto";
  if (state.category === "screenshot") {
    return shownInTimeline ? "lightbox.category.where.screenshotshown" : "lightbox.category.where.screenshothidden";
  }
  return shownInTimeline ? "lightbox.category.where.shown" : "lightbox.category.where.filtered";
}

// Photo / Screenshot / Document, for fixing a wrong automatic category
// (issue #2130). Owner-only: the endpoint only ever touches the requester's
// photos, so the control is not offered on anyone else's.
export function CategorySection({ photoDetail }: Props) {
  const { t } = useTranslation();
  const { userId } = useAuth();
  const { data } = useCurrentUserSelfDetailsQuery();
  const user = data as User | undefined;
  const setCategory = useSetPhotosCategoryMutation();

  const fromServer: CategoryState = {
    category: photoCategory(photoDetail),
    source: photoDetail.category_source === "user" ? "user" : "auto",
  };
  // The choice shows at once; the photo detail refetches behind it.
  const [optimistic, setOptimistic] = useState<CategoryState | null>(null);
  useEffect(() => {
    setOptimistic(null);
  }, [photoDetail.image_hash, fromServer.category, fromServer.source]);

  if (userId === null || photoDetail.owner?.id !== userId) {
    return null;
  }

  const state = optimistic ?? fromServer;
  const flags = {
    video: photoDetail.video,
    is_screenshot: state.category === "screenshot",
    is_document: state.category === "document",
    rating: photoDetail.rating,
  };
  const shownInTimeline = timelineFilterShows(
    savedTimelineFilter(user?.default_timeline_filter),
    flags,
    user?.favorite_min_rating ?? 0
  );

  const apply = (next: CategoryState, previous: CategoryState | null) => {
    setOptimistic(next);
    const imageHash = photoDetail.image_hash;
    setCategory.mutate(
      { image_hashes: [imageHash], category: next.category, category_source: next.source, notify: false },
      {
        onError: () => setOptimistic(null),
        onSuccess: () => {
          if (!previous) return;
          const id = `photo-category-${imageHash}`;
          showNotification({
            id,
            color: "teal",
            // Long enough to reach the Undo button; the app default is 3 s.
            autoClose: 10000,
            title: t("toasts.setcategorytitle"),
            message: (
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm">{t(`lightbox.category.marked.${next.category}`)}</Text>
                <Button
                  size="compact-sm"
                  variant="subtle"
                  onClick={() => {
                    hideNotification(id);
                    apply(previous, null);
                  }}
                >
                  {t("lightbox.category.undo")}
                </Button>
              </Group>
            ),
          });
        },
      }
    );
  };

  const onChange = (value: string) => {
    const category = value as PhotoCategory;
    if (category === state.category && state.source === "user") return;
    apply({ category, source: "user" }, state);
  };

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Title order={5}>{t("lightbox.category.title")}</Title>
        <Badge variant="light" color={state.source === "user" ? "blue" : "gray"}>
          {state.source === "user" ? t("lightbox.category.setbyyou") : t("lightbox.category.detected")}
        </Badge>
      </Group>
      <SegmentedControl
        fullWidth
        aria-label={t("lightbox.category.title")}
        value={state.category}
        onChange={onChange}
        disabled={setCategory.isPending}
        data={(["photo", "screenshot", "document"] as const).map(category => {
          const Icon = ICONS[category];
          return {
            value: category,
            label: (
              <Center style={{ gap: 6 }}>
                <Icon size={16} color={ICON_COLORS[category]} />
                <span>{t(`lightbox.category.${category}`)}</span>
              </Center>
            ),
          };
        })}
      />
      <Group gap={6} wrap="nowrap" align="flex-start">
        <InfoCircle size={16} style={{ flex: "none", marginTop: 2 }} color="var(--mantine-color-dimmed)" />
        <Text size="sm">{t(whereKey(state, shownInTimeline, photoDetail.hidden))}</Text>
      </Group>
      <Text size="xs" c="dimmed">
        {t("lightbox.category.kept")}
      </Text>
    </Stack>
  );
}
