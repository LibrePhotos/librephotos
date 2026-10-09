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

// What the control shows for one photo: the category, who set it, and the
// two flags behind it (both can be set; the control then shows Screenshot).
type CategoryState = {
  imageHash: string;
  category: PhotoCategory;
  source: "user" | "auto";
  is_screenshot: boolean;
  is_document: boolean;
};

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

// One undo toast at a time: a newer change replaces the older one's Undo.
const UNDO_NOTIFICATION_ID = "photo-category-undo";

// Where the item shows up, given its flags and the user's saved default
// timeline filter (what a bare "/" shows).
function whereKey(state: CategoryState, shownInTimeline: boolean, hidden: boolean) {
  if (hidden) return "lightbox.category.where.hiddenphoto";
  if (state.is_screenshot) {
    return shownInTimeline ? "lightbox.category.where.screenshotshown" : "lightbox.category.where.screenshothidden";
  }
  return shownInTimeline ? "lightbox.category.where.shown" : "lightbox.category.where.filtered";
}

function stateFromServer(photo: PhotoType): CategoryState {
  return {
    imageHash: photo.image_hash,
    category: photoCategory(photo),
    source: photo.category_source === "user" ? "user" : "auto",
    is_screenshot: !!photo.is_screenshot,
    is_document: !!photo.is_document,
  };
}

function pickedState(imageHash: string, category: PhotoCategory): CategoryState {
  return {
    imageHash,
    category,
    source: "user",
    is_screenshot: category === "screenshot",
    is_document: category === "document",
  };
}

// Photo / Screenshot / Document, for fixing a wrong automatic category
// (issue #2130). Owner-only: the endpoint only ever touches the requester's
// photos, so the control is not offered on anyone else's. Not for videos.
export function CategorySection({ photoDetail }: Props) {
  const { t } = useTranslation();
  const { userId } = useAuth();
  const { data } = useCurrentUserSelfDetailsQuery();
  const user = data as User | undefined;
  const setCategory = useSetPhotosCategoryMutation();

  const fromServer = stateFromServer(photoDetail);
  // The choice shows at once; the photo detail refetches behind it. Keyed by
  // hash, so it never shows on another photo the lightbox moves to.
  const [optimistic, setOptimistic] = useState<CategoryState | null>(null);
  useEffect(() => {
    setOptimistic(null);
  }, [fromServer.imageHash, fromServer.category, fromServer.source]);

  if (userId === null || photoDetail.owner?.id !== userId || photoDetail.video) {
    return null;
  }

  const state = optimistic?.imageHash === fromServer.imageHash ? optimistic : fromServer;
  const shownInTimeline = timelineFilterShows(
    savedTimelineFilter(user?.default_timeline_filter),
    {
      video: photoDetail.video,
      is_screenshot: state.is_screenshot,
      is_document: state.is_document,
      rating: photoDetail.rating,
    },
    user?.favorite_min_rating ?? 0
  );

  // `next` is what the photo becomes; `undo` is what the toast's Undo puts
  // back (null: no toast). Everything is bound to the photo's hash, so an
  // Undo clicked after the lightbox moved on still targets this photo.
  const apply = (next: CategoryState, undo: CategoryState | null) => {
    setOptimistic(next);
    // A detected category goes back through the detectors ("auto"), which
    // also restores a photo they flagged as both; a user's earlier choice is
    // simply set again.
    const category = next.source === "auto" ? "auto" : next.category;
    setCategory.mutate(
      { image_hashes: [next.imageHash], category, notify: false },
      {
        onError: () => setOptimistic(null),
        onSuccess: () => {
          hideNotification(UNDO_NOTIFICATION_ID);
          if (!undo) return;
          showNotification({
            id: UNDO_NOTIFICATION_ID,
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
                    hideNotification(UNDO_NOTIFICATION_ID);
                    apply(undo, null);
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
        onChange={value => apply(pickedState(state.imageHash, value as PhotoCategory), state)}
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
