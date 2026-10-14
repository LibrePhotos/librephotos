import {
  IconAlbum,
  IconAlbumOff,
  IconArchive,
  IconBook,
  IconCalendarEvent,
  IconChartBar,
  IconClock,
  IconClockOff,
  IconCloud,
  IconEyeOff,
  IconFaceId,
  IconFileText,
  IconFilter,
  IconFolder,
  IconFolders,
  IconGraph,
  IconHeart,
  IconLanguage,
  IconLock,
  IconMap,
  IconMapPinOff,
  IconMoodSmile,
  IconPhoto,
  IconRobot,
  IconScreenshot,
  IconSettings,
  IconShare,
  IconShield,
  IconSparkles,
  IconTag,
  IconTimeline,
  IconTrash,
  IconUser,
  IconUsers,
  IconVectorTriangle,
  IconVideo,
} from "@tabler/icons-react";
import type { useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import React from "react";
import type { SpotlightAction } from "./useSpotlightActions";

type Translate = TFunction<"translation", undefined>;
type Navigate = ReturnType<typeof useNavigate>;

export const SPOTLIGHT_ICON_SIZE = 20;
// Module-level so the action lists do not depend on a per-render object.
export const iconProps = { size: SPOTLIGHT_ICON_SIZE, stroke: 1.5 };

// The pages of the app.
function pageActions(t: Translate, navigate: Navigate): SpotlightAction[] {
  return [
    {
      id: "nav-photos",
      label: t("spotlight.nav.photos"),
      leftSection: React.createElement(IconPhoto, iconProps),
      onClick: () => void navigate({ to: "/" }),
      keywords: ["photos", "home", "gallery"],
    },
    {
      id: "nav-albums",
      label: t("spotlight.nav.albums"),
      leftSection: React.createElement(IconAlbum, iconProps),
      onClick: () => void navigate({ to: "/album" }),
      keywords: ["albums", "collections"],
    },
    {
      id: "nav-memories",
      label: t("spotlight.nav.memories"),
      leftSection: React.createElement(IconSparkles, iconProps),
      onClick: () => void navigate({ to: "/memories" }),
      keywords: ["memories", "on this day", "years ago", "anniversary", "rediscover"],
    },
    {
      id: "nav-people",
      label: t("spotlight.nav.people"),
      leftSection: React.createElement(IconUsers, iconProps),
      onClick: () => void navigate({ to: "/album/persons" }),
      keywords: ["people", "persons", "faces"],
    },
    {
      id: "nav-filterphotos",
      label: t("spotlight.nav.filterphotos"),
      leftSection: React.createElement(IconFilter, iconProps),
      // The search page without words: every photo the filters match.
      onClick: () => void navigate({ to: "/search" }),
      keywords: ["filter", "camera", "lens", "iso", "aperture", "rating", "raw", "date", "people", "together"],
    },
    {
      id: "nav-places",
      label: t("spotlight.nav.places"),
      leftSection: React.createElement(IconMap, iconProps),
      onClick: () => void navigate({ to: "/album/places" }),
      keywords: ["places", "locations", "map"],
    },
    {
      id: "nav-things",
      label: t("spotlight.nav.things"),
      leftSection: React.createElement(IconTag, iconProps),
      onClick: () => void navigate({ to: "/album/things" }),
      keywords: ["things", "objects", "tags"],
    },
    {
      id: "nav-tags",
      label: t("spotlight.nav.tags"),
      leftSection: React.createElement(IconTag, iconProps),
      onClick: () => void navigate({ to: "/album/tags" }),
      keywords: ["tags", "keywords", "labels"],
    },
    {
      id: "nav-favorites",
      label: t("spotlight.nav.favorites"),
      leftSection: React.createElement(IconHeart, iconProps),
      onClick: () => void navigate({ to: "/favorites" }),
      keywords: ["favorites", "liked", "starred"],
    },
    {
      id: "nav-hidden",
      label: t("spotlight.nav.hidden"),
      leftSection: React.createElement(IconEyeOff, iconProps),
      onClick: () => void navigate({ to: "/hidden" }),
      keywords: ["hidden", "private"],
    },
    {
      id: "nav-archived",
      label: t("spotlight.nav.archived"),
      leftSection: React.createElement(IconArchive, iconProps),
      onClick: () => void navigate({ to: "/archived" }),
      keywords: ["archive", "archived", "sorted"],
    },
    {
      id: "nav-videos",
      label: t("spotlight.nav.videos"),
      leftSection: React.createElement(IconVideo, iconProps),
      onClick: () => void navigate({ to: "/videos" }),
      keywords: ["videos", "movies", "clips"],
    },
    {
      id: "nav-screenshots",
      label: t("spotlight.nav.screenshots"),
      leftSection: React.createElement(IconScreenshot, iconProps),
      onClick: () => void navigate({ to: "/screenshots" }),
      keywords: ["screenshots", "screen captures", "screengrabs"],
    },
    {
      id: "nav-documents",
      label: t("spotlight.nav.documents"),
      description: t("spotlight.nav.documentsDesc"),
      leftSection: React.createElement(IconFileText, iconProps),
      onClick: () => void navigate({ to: "/documents" }),
      keywords: ["documents", "receipts", "letters", "scans", "paper"],
    },
    {
      id: "nav-trash",
      label: t("spotlight.nav.trash"),
      leftSection: React.createElement(IconTrash, iconProps),
      onClick: () => void navigate({ to: "/deleted" }),
      keywords: ["trash", "deleted", "bin"],
    },
    {
      id: "nav-recent",
      label: t("spotlight.nav.recent"),
      leftSection: React.createElement(IconClock, iconProps),
      onClick: () => void navigate({ to: "/recent" }),
      keywords: ["recent", "recently added", "new"],
    },
    {
      id: "nav-notimestamp",
      label: t("spotlight.nav.noTimestamp"),
      leftSection: React.createElement(IconClockOff, iconProps),
      onClick: () => void navigate({ to: "/notimestamp" }),
      keywords: ["no timestamp", "without timestamp", "no date"],
    },
    {
      id: "nav-nolocation",
      label: t("spotlight.nav.noLocation"),
      leftSection: React.createElement(IconMapPinOff, iconProps),
      onClick: () => void navigate({ to: "/nolocation" }),
      keywords: ["no location", "without location", "no gps", "missing location"],
    },
    {
      id: "nav-noalbum",
      label: t("spotlight.nav.notInAlbum"),
      leftSection: React.createElement(IconAlbumOff, iconProps),
      onClick: () => void navigate({ to: "/noalbum" }),
      keywords: ["no album", "not in album", "unsorted", "without album"],
    },
    {
      id: "nav-events",
      label: t("spotlight.nav.events"),
      leftSection: React.createElement(IconCalendarEvent, iconProps),
      onClick: () => void navigate({ to: "/album/events" }),
      keywords: ["events", "auto albums"],
    },
    {
      id: "nav-folders",
      label: t("spotlight.nav.folders"),
      leftSection: React.createElement(IconFolders, iconProps),
      onClick: () => void navigate({ to: "/album/folder" }),
      keywords: ["folders", "directories", "file browser"],
    },
    {
      id: "nav-myalbums",
      label: t("spotlight.nav.myAlbums"),
      leftSection: React.createElement(IconFolder, iconProps),
      onClick: () => void navigate({ to: "/album/user" }),
      keywords: ["my albums", "user albums"],
    },
    {
      id: "nav-sharing",
      label: t("spotlight.nav.sharing"),
      leftSection: React.createElement(IconShare, iconProps),
      onClick: () => void navigate({ to: "/sharing" }),
      keywords: ["sharing", "shared"],
    },
    {
      id: "nav-faces",
      label: t("spotlight.nav.faces"),
      leftSection: React.createElement(IconMoodSmile, iconProps),
      onClick: () => void navigate({ to: "/faces" }),
      keywords: ["faces", "face dashboard", "recognition"],
    },
    {
      id: "nav-settings",
      label: t("spotlight.nav.settings"),
      leftSection: React.createElement(IconSettings, iconProps),
      onClick: () => void navigate({ to: "/settings" }),
      keywords: ["settings", "preferences", "options"],
    },
    {
      id: "nav-profile",
      label: t("spotlight.nav.profile"),
      leftSection: React.createElement(IconUser, iconProps),
      onClick: () => void navigate({ to: "/profile" }),
      keywords: ["profile", "account", "user"],
    },
    {
      id: "nav-library",
      label: t("spotlight.nav.library"),
      leftSection: React.createElement(IconBook, iconProps),
      onClick: () => void navigate({ to: "/library" }),
      keywords: ["library", "scan", "manage"],
    },
  ];
}

// The statistics pages.
function statisticsActions(t: Translate, navigate: Navigate): SpotlightAction[] {
  return [
    {
      id: "nav-statistics",
      label: t("spotlight.nav.statistics"),
      leftSection: React.createElement(IconChartBar, iconProps),
      onClick: () => void navigate({ to: "/statistics" }),
      keywords: ["statistics", "stats", "charts"],
    },
    {
      id: "nav-placetree",
      label: t("spotlight.nav.placeTree"),
      leftSection: React.createElement(IconGraph, iconProps),
      onClick: () => void navigate({ to: "/statistics/placetree" }),
      keywords: ["place tree", "location tree"],
    },
    {
      id: "nav-wordclouds",
      label: t("spotlight.nav.wordClouds"),
      leftSection: React.createElement(IconCloud, iconProps),
      onClick: () => void navigate({ to: "/statistics/wordclouds" }),
      keywords: ["word clouds", "tags cloud"],
    },
    {
      id: "nav-timeline",
      label: t("spotlight.nav.timeline"),
      leftSection: React.createElement(IconTimeline, iconProps),
      onClick: () => void navigate({ to: "/statistics/timeline" }),
      keywords: ["timeline", "history"],
    },
    {
      id: "nav-socialgraph",
      label: t("spotlight.nav.socialGraph"),
      leftSection: React.createElement(IconGraph, iconProps),
      onClick: () => void navigate({ to: "/statistics/socialgraph" }),
      keywords: ["social graph", "connections"],
    },
    {
      id: "nav-faceclusters",
      label: t("spotlight.nav.faceClusters"),
      leftSection: React.createElement(IconVectorTriangle, iconProps),
      onClick: () => void navigate({ to: "/statistics/faceclusters" }),
      keywords: ["face clusters", "clustering"],
    },
  ];
}

// The admin area, then the settings and profile entries found by what they change.
function settingsActions(t: Translate, navigate: Navigate, isAdmin: boolean): SpotlightAction[] {
  return [
    // The admin area is for superusers only, as in the profile menu
    ...(isAdmin
      ? [
          {
            id: "nav-admin",
            label: t("spotlight.nav.admin"),
            leftSection: React.createElement(IconShield, iconProps),
            onClick: () => void navigate({ to: "/admin" }),
            keywords: ["admin", "administration", "users", "site settings"],
          },
        ]
      : []),
    // Settings-focused navigation with helpful keywords
    {
      id: "nav-settings-scan",
      label: t("spotlight.nav.scanSettings"),
      description: t("spotlight.nav.scanSettingsDesc"),
      leftSection: React.createElement(IconSettings, iconProps),
      onClick: () => void navigate({ to: "/settings" }),
      keywords: ["scan", "confidence", "semantic search", "scene", "options"],
    },
    {
      id: "nav-settings-metadata",
      label: t("spotlight.nav.metadataSettings"),
      description: t("spotlight.nav.metadataSettingsDesc"),
      leftSection: React.createElement(IconSettings, iconProps),
      onClick: () => void navigate({ to: "/settings" }),
      keywords: ["metadata", "sync", "sidecar", "timezone", "favorite", "rating"],
    },
    {
      id: "nav-settings-face",
      label: t("spotlight.nav.faceSettings"),
      description: t("spotlight.nav.faceSettingsDesc"),
      leftSection: React.createElement(IconFaceId, iconProps),
      onClick: () => void navigate({ to: "/settings" }),
      keywords: ["face", "recognition", "cluster", "clustering", "unknown faces"],
    },
    {
      id: "nav-settings-llm",
      label: t("spotlight.nav.llmSettings"),
      description: t("spotlight.nav.llmSettingsDesc"),
      leftSection: React.createElement(IconRobot, iconProps),
      onClick: () => void navigate({ to: "/settings" }),
      keywords: ["caption", "context", "ai", "names", "places", "llm"],
    },
    {
      id: "nav-profile-language",
      label: t("spotlight.nav.changeLanguage"),
      description: t("spotlight.nav.changeLanguageDesc"),
      leftSection: React.createElement(IconLanguage, iconProps),
      onClick: () => void navigate({ to: "/profile" }),
      keywords: ["language", "locale", "translation", "english", "german", "french", "spanish"],
    },
    {
      id: "nav-profile-password",
      label: t("spotlight.nav.changePassword"),
      description: t("spotlight.nav.changePasswordDesc"),
      leftSection: React.createElement(IconLock, iconProps),
      onClick: () => void navigate({ to: "/profile" }),
      keywords: ["password", "security", "change password"],
    },
    {
      id: "nav-profile-avatar",
      label: t("spotlight.nav.changeAvatar"),
      description: t("spotlight.nav.changeAvatarDesc"),
      leftSection: React.createElement(IconUser, iconProps),
      onClick: () => void navigate({ to: "/profile" }),
      keywords: ["avatar", "profile picture", "photo"],
    },
  ];
}

/** The palette's Navigation group. */
export function buildNavigationActions(t: Translate, navigate: Navigate, isAdmin: boolean): SpotlightAction[] {
  return [...pageActions(t, navigate), ...statisticsActions(t, navigate), ...settingsActions(t, navigate, isAdmin)];
}
