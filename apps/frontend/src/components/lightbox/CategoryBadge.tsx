import { Badge, Box, Button, Group, Menu, Text } from "@mantine/core";
import { hideNotification, showNotification } from "@mantine/notifications";
import {
  IconCheck as Check,
  IconChevronDown as ChevronDown,
  IconFileText as FileText,
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

const CATEGORIES: readonly PhotoCategory[] = ["photo", "screenshot", "document"];

const ICONS: Record<PhotoCategory, typeof Photo> = {
  photo: Photo,
  screenshot: Screenshot,
  document: FileText,
};

const COLORS: Record<PhotoCategory, string> = {
  photo: "blue",
  screenshot: "violet",
  document: "orange",
};

// One undo toast at a time: a newer change replaces the older one's Undo.
const UNDO_NOTIFICATION_ID = "photo-category-undo";

// Where the item shows up, given its flags and the user's saved default
// timeline filter (what a bare "/" shows).
function whereKey(state: CategoryState, shownInTimeline: boolean, photo: PhotoType) {
  if (photo.in_trashcan) return "lightbox.category.where.trashed";
  if (photo.hidden) return "lightbox.category.where.hiddenphoto";
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
// (issue #2130): a badge on the file row that opens a menu, so a control most
// photos never need stays out of the way. Owner-only: the endpoint only ever
// touches the requester's photos, so the control is not offered on anyone
// else's. A video gets it only to clear a wrong flag: it can never become a
// screenshot or document.
export function CategoryBadge({ photoDetail }: Props) {
  const { t } = useTranslation();
  const { userId } = useAuth();
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const setCategory = useSetPhotosCategoryMutation();

  const fromServer = stateFromServer(photoDetail);
  // The choice shows at once; the photo detail refetches behind it. Keyed by
  // hash, so it never shows on another photo the lightbox moves to.
  const [optimistic, setOptimistic] = useState<CategoryState | null>(null);
  useEffect(() => {
    setOptimistic(null);
  }, [fromServer.imageHash, fromServer.category, fromServer.source]);

  const flaggedVideo = photoDetail.video && (photoDetail.is_screenshot || photoDetail.is_document);
  if (userId === null || photoDetail.owner?.id !== userId || (photoDetail.video && !flaggedVideo)) {
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

  const Icon = ICONS[state.category];
  return (
    <Menu position="bottom-end" width={260} shadow="md">
      <Menu.Target>
        <Badge
          component="button"
          type="button"
          variant="light"
          color={COLORS[state.category]}
          leftSection={<Icon size={12} />}
          rightSection={<ChevronDown size={12} />}
          aria-label={t("lightbox.category.change", { category: t(`lightbox.category.${state.category}`) })}
          disabled={setCategory.isPending}
          style={{ flex: "none", cursor: "pointer" }}
        >
          {t(`lightbox.category.${state.category}`)}
        </Badge>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>
          {state.source === "user" ? t("lightbox.category.setbyyou") : t("lightbox.category.detected")}
        </Menu.Label>
        {CATEGORIES.map(category => {
          const ItemIcon = ICONS[category];
          const current = category === state.category;
          return (
            <Menu.Item
              key={category}
              leftSection={<ItemIcon size={16} color={`var(--mantine-color-${COLORS[category]}-6)`} />}
              rightSection={current ? <Check size={14} /> : null}
              aria-current={current || undefined}
              // The server never makes a video a screenshot or a document.
              disabled={photoDetail.video && category !== "photo"}
              onClick={() => {
                if (!current) apply(pickedState(state.imageHash, category), state);
              }}
            >
              {t(`lightbox.category.${category}`)}
            </Menu.Item>
          );
        })}
        <Menu.Divider />
        <Box px="sm" py={6}>
          <Text size="xs">{t(whereKey(state, shownInTimeline, photoDetail))}</Text>
          <Text size="xs" c="dimmed" mt={4}>
            {t("lightbox.category.kept")}
          </Text>
        </Box>
      </Menu.Dropdown>
    </Menu>
  );
}
