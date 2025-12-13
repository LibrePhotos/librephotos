import { Avatar, useMantineColorScheme } from "@mantine/core";
import type { SpotlightActionData, SpotlightActionGroupData } from "@mantine/spotlight";
import {
  IconAlbum,
  IconBook,
  IconBrandNextcloud,
  IconCalendarEvent,
  IconChartBar,
  IconClock,
  IconClockOff,
  IconCloud,
  IconEyeOff,
  IconFaceId,
  IconFolder,
  IconFolders,
  IconGraph,
  IconHeart,
  IconHome,
  IconLanguage,
  IconLock,
  IconMap,
  IconMoodSmile,
  IconMoon,
  IconPalette,
  IconPhoto,
  IconPhotoX,
  IconRefresh,
  IconRefreshDot,
  IconRobot,
  IconSearch,
  IconSettings,
  IconShare,
  IconShield,
  IconSun,
  IconTag,
  IconTimeline,
  IconTrash,
  IconUser,
  IconUsers,
  IconVectorTriangle,
  IconVideo,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";

import { useTrainFacesMutation } from "../../api_client/faces";
import { useGenerateAutoAlbumsMutation, useRescanPhotosMutation, useScanPhotosMutation, useWorkerQuery } from "../../api_client/jobs/hooks";
import { useDeleteMissingPhotosMutation } from "../../api_client/photos/hooks";
import { fetchClient } from "../../api_client/api";
import { notification } from "../../service/notifications";
import { useSearch, SearchOptionType, type SearchOption } from "../../service/use-search";
import { useAuth } from "../../hooks/useAuth";

const ICON_SIZE = 20;
const AVATAR_SIZE = 28;

type SpotlightAction = SpotlightActionData & {
  keywords?: string[];
};

function getThumbnailUrl(imageHash: string | undefined): string | undefined {
  if (!imageHash) return undefined;
  return `${serverAddress}/media/square_thumbnails_small/${imageHash}`;
}

function getFaceUrl(faceUrl: string | undefined): string | undefined {
  if (!faceUrl) return undefined;
  // face_url is already a path like /media/faces/...
  return faceUrl.startsWith("http") ? faceUrl : `${serverAddress}${faceUrl}`;
}

function searchOptionToAction(option: SearchOption, navigate: ReturnType<typeof useNavigate>): SpotlightAction {
  const iconProps = { size: ICON_SIZE, stroke: 1.5 };

  const getLeftSection = () => {
    // For people, show face avatar
    if (option.type === SearchOptionType.PEOPLE && option.thumbnail) {
      return React.createElement(Avatar, {
        src: getFaceUrl(option.thumbnail),
        size: AVATAR_SIZE,
        radius: "xl",
      });
    }

    // For user albums (my albums) with thumbnails, show album cover
    if (option.type === SearchOptionType.USER_ALBUM && option.thumbnail) {
      return React.createElement(Avatar, {
        src: getThumbnailUrl(option.thumbnail),
        size: AVATAR_SIZE,
        radius: "sm",
      });
    }

    // Fallback to icons for everything else
    switch (option.type) {
      case SearchOptionType.PLACE_ALBUM:
        return React.createElement(IconMap, iconProps);
      case SearchOptionType.THING_ALBUM:
        return React.createElement(IconTag, iconProps);
      case SearchOptionType.USER_ALBUM:
        return React.createElement(IconAlbum, iconProps);
      case SearchOptionType.PEOPLE:
        return React.createElement(IconUser, iconProps);
      case SearchOptionType.EXAMPLE:
      default:
        return React.createElement(IconPhoto, iconProps);
    }
  };

  const getOnClick = () => {
    switch (option.type) {
      case SearchOptionType.EXAMPLE:
        return () => navigate({ to: `/search/${option.data}` });
      case SearchOptionType.USER_ALBUM:
        return () => navigate({ to: `/album/user/${option.data}` });
      case SearchOptionType.PLACE_ALBUM:
        return () => navigate({ to: `/album/places/${option.data}` });
      case SearchOptionType.THING_ALBUM:
        return () => navigate({ to: `/album/things/${option.data}` });
      case SearchOptionType.PEOPLE:
        return () => navigate({ to: `/album/persons/${option.data}` });
      default:
        return () => navigate({ to: `/search/${option.value}` });
    }
  };

  return {
    id: `search-${option.type}-${option.data || option.value}`,
    label: option.value,
    leftSection: getLeftSection(),
    onClick: getOnClick(),
    keywords: [option.value.toLowerCase()],
  };
}

export function useSpotlightActions(query: string = "") {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const { options: searchOptions, filterOptions, isLoading: isSearchLoading } = useSearch();

  // Worker and mutation hooks
  const { data: worker } = useWorkerQuery();
  const workerAvailable = worker?.queue_can_accept_job ?? false;

  const scanPhotos = useScanPhotosMutation();
  const rescanPhotos = useRescanPhotosMutation();
  const { mutate: generateAutoAlbums } = useGenerateAutoAlbumsMutation();
  const deleteMissingPhotos = useDeleteMissingPhotosMutation();
  const trainFaces = useTrainFacesMutation();

  const iconProps = { size: ICON_SIZE, stroke: 1.5 };

  // Navigation actions
  const navigationActions: SpotlightAction[] = useMemo(
    () => [
      {
        id: "nav-photos",
        label: t("spotlight.nav.photos"),
        leftSection: React.createElement(IconPhoto, iconProps),
        onClick: () => navigate({ to: "/" }),
        keywords: ["photos", "home", "gallery"],
      },
      {
        id: "nav-albums",
        label: t("spotlight.nav.albums"),
        leftSection: React.createElement(IconAlbum, iconProps),
        onClick: () => navigate({ to: "/album" }),
        keywords: ["albums", "collections"],
      },
      {
        id: "nav-people",
        label: t("spotlight.nav.people"),
        leftSection: React.createElement(IconUsers, iconProps),
        onClick: () => navigate({ to: "/album/persons" }),
        keywords: ["people", "persons", "faces"],
      },
      {
        id: "nav-places",
        label: t("spotlight.nav.places"),
        leftSection: React.createElement(IconMap, iconProps),
        onClick: () => navigate({ to: "/album/places" }),
        keywords: ["places", "locations", "map"],
      },
      {
        id: "nav-things",
        label: t("spotlight.nav.things"),
        leftSection: React.createElement(IconTag, iconProps),
        onClick: () => navigate({ to: "/album/things" }),
        keywords: ["things", "objects", "tags"],
      },
      {
        id: "nav-favorites",
        label: t("spotlight.nav.favorites"),
        leftSection: React.createElement(IconHeart, iconProps),
        onClick: () => navigate({ to: "/favorites" }),
        keywords: ["favorites", "liked", "starred"],
      },
      {
        id: "nav-hidden",
        label: t("spotlight.nav.hidden"),
        leftSection: React.createElement(IconEyeOff, iconProps),
        onClick: () => navigate({ to: "/hidden" }),
        keywords: ["hidden", "private"],
      },
      {
        id: "nav-videos",
        label: t("spotlight.nav.videos"),
        leftSection: React.createElement(IconVideo, iconProps),
        onClick: () => navigate({ to: "/videos" }),
        keywords: ["videos", "movies", "clips"],
      },
      {
        id: "nav-trash",
        label: t("spotlight.nav.trash"),
        leftSection: React.createElement(IconTrash, iconProps),
        onClick: () => navigate({ to: "/deleted" }),
        keywords: ["trash", "deleted", "bin"],
      },
      {
        id: "nav-recent",
        label: t("spotlight.nav.recent"),
        leftSection: React.createElement(IconClock, iconProps),
        onClick: () => navigate({ to: "/recent" }),
        keywords: ["recent", "recently added", "new"],
      },
      {
        id: "nav-notimestamp",
        label: t("spotlight.nav.noTimestamp"),
        leftSection: React.createElement(IconClockOff, iconProps),
        onClick: () => navigate({ to: "/notimestamp" }),
        keywords: ["no timestamp", "without timestamp", "no date"],
      },
      {
        id: "nav-events",
        label: t("spotlight.nav.events"),
        leftSection: React.createElement(IconCalendarEvent, iconProps),
        onClick: () => navigate({ to: "/album/events" }),
        keywords: ["events", "auto albums"],
      },
      {
        id: "nav-folders",
        label: t("spotlight.nav.folders"),
        leftSection: React.createElement(IconFolders, iconProps),
        onClick: () => navigate({ to: "/album/folder" }),
        keywords: ["folders", "directories", "file browser"],
      },
      {
        id: "nav-myalbums",
        label: t("spotlight.nav.myAlbums"),
        leftSection: React.createElement(IconFolder, iconProps),
        onClick: () => navigate({ to: "/album/user" }),
        keywords: ["my albums", "user albums"],
      },
      {
        id: "nav-sharing",
        label: t("spotlight.nav.sharing"),
        leftSection: React.createElement(IconShare, iconProps),
        onClick: () => navigate({ to: "/sharing" }),
        keywords: ["sharing", "shared"],
      },
      {
        id: "nav-faces",
        label: t("spotlight.nav.faces"),
        leftSection: React.createElement(IconMoodSmile, iconProps),
        onClick: () => navigate({ to: "/faces" }),
        keywords: ["faces", "face dashboard", "recognition"],
      },
      {
        id: "nav-settings",
        label: t("spotlight.nav.settings"),
        leftSection: React.createElement(IconSettings, iconProps),
        onClick: () => navigate({ to: "/settings" }),
        keywords: ["settings", "preferences", "options"],
      },
      {
        id: "nav-profile",
        label: t("spotlight.nav.profile"),
        leftSection: React.createElement(IconUser, iconProps),
        onClick: () => navigate({ to: "/profile" }),
        keywords: ["profile", "account", "user"],
      },
      {
        id: "nav-library",
        label: t("spotlight.nav.library"),
        leftSection: React.createElement(IconBook, iconProps),
        onClick: () => navigate({ to: "/library" }),
        keywords: ["library", "scan", "manage"],
      },
      {
        id: "nav-statistics",
        label: t("spotlight.nav.statistics"),
        leftSection: React.createElement(IconChartBar, iconProps),
        onClick: () => navigate({ to: "/statistics" }),
        keywords: ["statistics", "stats", "charts"],
      },
      {
        id: "nav-placetree",
        label: t("spotlight.nav.placeTree"),
        leftSection: React.createElement(IconGraph, iconProps),
        onClick: () => navigate({ to: "/statistics/placetree" }),
        keywords: ["place tree", "location tree"],
      },
      {
        id: "nav-wordclouds",
        label: t("spotlight.nav.wordClouds"),
        leftSection: React.createElement(IconCloud, iconProps),
        onClick: () => navigate({ to: "/statistics/wordclouds" }),
        keywords: ["word clouds", "tags cloud"],
      },
      {
        id: "nav-timeline",
        label: t("spotlight.nav.timeline"),
        leftSection: React.createElement(IconTimeline, iconProps),
        onClick: () => navigate({ to: "/statistics/timeline" }),
        keywords: ["timeline", "history"],
      },
      {
        id: "nav-socialgraph",
        label: t("spotlight.nav.socialGraph"),
        leftSection: React.createElement(IconGraph, iconProps),
        onClick: () => navigate({ to: "/statistics/socialgraph" }),
        keywords: ["social graph", "connections"],
      },
      {
        id: "nav-faceclusters",
        label: t("spotlight.nav.faceClusters"),
        leftSection: React.createElement(IconVectorTriangle, iconProps),
        onClick: () => navigate({ to: "/statistics/faceclusters" }),
        keywords: ["face clusters", "clustering"],
      },
      {
        id: "nav-admin",
        label: t("spotlight.nav.admin"),
        leftSection: React.createElement(IconShield, iconProps),
        onClick: () => navigate({ to: "/admin" }),
        keywords: ["admin", "administration", "users", "site settings"],
      },
      // Settings-focused navigation with helpful keywords
      {
        id: "nav-settings-scan",
        label: t("spotlight.nav.scanSettings"),
        description: t("spotlight.nav.scanSettingsDesc"),
        leftSection: React.createElement(IconSettings, iconProps),
        onClick: () => navigate({ to: "/settings" }),
        keywords: ["scan", "confidence", "semantic search", "scene", "options"],
      },
      {
        id: "nav-settings-metadata",
        label: t("spotlight.nav.metadataSettings"),
        description: t("spotlight.nav.metadataSettingsDesc"),
        leftSection: React.createElement(IconSettings, iconProps),
        onClick: () => navigate({ to: "/settings" }),
        keywords: ["metadata", "sync", "sidecar", "timezone", "favorite", "rating"],
      },
      {
        id: "nav-settings-face",
        label: t("spotlight.nav.faceSettings"),
        description: t("spotlight.nav.faceSettingsDesc"),
        leftSection: React.createElement(IconFaceId, iconProps),
        onClick: () => navigate({ to: "/settings" }),
        keywords: ["face", "recognition", "model", "hog", "cnn", "cluster", "clustering"],
      },
      {
        id: "nav-settings-llm",
        label: t("spotlight.nav.llmSettings"),
        description: t("spotlight.nav.llmSettingsDesc"),
        leftSection: React.createElement(IconRobot, iconProps),
        onClick: () => navigate({ to: "/settings" }),
        keywords: ["llm", "ai", "caption", "language model", "mistral"],
      },
      {
        id: "nav-profile-language",
        label: t("spotlight.nav.changeLanguage"),
        description: t("spotlight.nav.changeLanguageDesc"),
        leftSection: React.createElement(IconLanguage, iconProps),
        onClick: () => navigate({ to: "/profile" }),
        keywords: ["language", "locale", "translation", "english", "german", "french", "spanish"],
      },
      {
        id: "nav-profile-password",
        label: t("spotlight.nav.changePassword"),
        description: t("spotlight.nav.changePasswordDesc"),
        leftSection: React.createElement(IconLock, iconProps),
        onClick: () => navigate({ to: "/profile" }),
        keywords: ["password", "security", "change password"],
      },
      {
        id: "nav-profile-avatar",
        label: t("spotlight.nav.changeAvatar"),
        description: t("spotlight.nav.changeAvatarDesc"),
        leftSection: React.createElement(IconUser, iconProps),
        onClick: () => navigate({ to: "/profile" }),
        keywords: ["avatar", "profile picture", "photo"],
      },
    ],
    [t, navigate]
  );

  // Job actions
  const jobActions: SpotlightAction[] = useMemo(
    () => [
      {
        id: "action-scan",
        label: t("spotlight.actions.scanPhotos"),
        description: workerAvailable ? undefined : t("topmenu.busy"),
        leftSection: React.createElement(IconRefresh, iconProps),
        onClick: () => {
          if (workerAvailable) {
            scanPhotos.mutate();
          }
        },
        disabled: !workerAvailable,
        keywords: ["scan", "import", "photos"],
      },
      {
        id: "action-rescan",
        label: t("spotlight.actions.rescanPhotos"),
        description: workerAvailable ? undefined : t("topmenu.busy"),
        leftSection: React.createElement(IconRefreshDot, iconProps),
        onClick: () => {
          if (workerAvailable) {
            rescanPhotos.mutate();
          }
        },
        disabled: !workerAvailable,
        keywords: ["rescan", "full scan", "reprocess"],
      },
      {
        id: "action-train-faces",
        label: t("spotlight.actions.trainFaces"),
        description: workerAvailable ? undefined : t("topmenu.busy"),
        leftSection: React.createElement(IconFaceId, iconProps),
        onClick: () => {
          if (workerAvailable) {
            trainFaces.mutate();
            notification.trainFaces();
          }
        },
        disabled: !workerAvailable,
        keywords: ["train", "faces", "recognition", "learn"],
      },
      {
        id: "action-rescan-faces",
        label: t("spotlight.actions.rescanFaces"),
        description: workerAvailable ? undefined : t("topmenu.busy"),
        leftSection: React.createElement(IconMoodSmile, iconProps),
        onClick: () => {
          if (workerAvailable) {
            fetchClient.get("/scanfaces");
            notification.rescanFaces();
          }
        },
        disabled: !workerAvailable,
        keywords: ["rescan", "detect", "faces"],
      },
      {
        id: "action-generate-events",
        label: t("spotlight.actions.generateEvents"),
        description: workerAvailable ? undefined : t("topmenu.busy"),
        leftSection: React.createElement(IconCalendarEvent, iconProps),
        onClick: () => {
          if (workerAvailable) {
            generateAutoAlbums();
          }
        },
        disabled: !workerAvailable,
        keywords: ["generate", "events", "albums", "auto"],
      },
      {
        id: "action-delete-missing",
        label: t("spotlight.actions.deleteMissing"),
        description: workerAvailable ? undefined : t("topmenu.busy"),
        leftSection: React.createElement(IconPhotoX, iconProps),
        onClick: () => {
          if (workerAvailable) {
            deleteMissingPhotos.mutate();
          }
        },
        disabled: !workerAvailable,
        keywords: ["delete", "missing", "cleanup"],
      },
    ],
    [t, workerAvailable, scanPhotos, rescanPhotos, trainFaces, generateAutoAlbums, deleteMissingPhotos]
  );

  // Quick actions
  const quickActions: SpotlightAction[] = useMemo(
    () => [
      {
        id: "quick-toggle-theme",
        label: t("spotlight.quick.toggleTheme"),
        leftSection: React.createElement(colorScheme === "dark" ? IconSun : IconMoon, iconProps),
        onClick: () => toggleColorScheme(),
        keywords: ["theme", "dark", "light", "mode", "toggle"],
      },
    ],
    [t, colorScheme, toggleColorScheme]
  );

  // Convert search options to actions
  const searchActions: SpotlightAction[] = useMemo(
    () => searchOptions.map((option) => searchOptionToAction(option, navigate)),
    [searchOptions, navigate]
  );

  // "Search for [query]" action - always first when there's a query
  const searchForQueryAction: SpotlightAction | null = useMemo(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return null;

    return {
      id: "search-query",
      label: t("spotlight.searchFor", { query: trimmedQuery }),
      leftSection: React.createElement(IconSearch, { size: ICON_SIZE, stroke: 1.5 }),
      onClick: () => navigate({ to: `/search/${encodeURIComponent(trimmedQuery)}` }),
      keywords: [trimmedQuery.toLowerCase()],
    };
  }, [query, t, navigate]);

  // Build grouped actions
  const actions: (SpotlightActionGroupData | SpotlightActionData)[] = useMemo(() => {
    const groups: (SpotlightActionGroupData | SpotlightActionData)[] = [];

    // Search group with "Search for [query]" as first option
    const allSearchActions: SpotlightAction[] = [];
    if (searchForQueryAction) {
      allSearchActions.push(searchForQueryAction);
    }
    allSearchActions.push(...searchActions);

    if (allSearchActions.length > 0) {
      groups.push({
        group: t("spotlight.groups.search"),
        actions: allSearchActions,
      });
    }

    if (isAuthenticated) {
      groups.push({
        group: t("spotlight.groups.navigation"),
        actions: navigationActions,
      });

      groups.push({
        group: t("spotlight.groups.actions"),
        actions: jobActions,
      });
    }

    groups.push({
      group: t("spotlight.groups.quickActions"),
      actions: quickActions,
    });

    return groups;
  }, [t, isAuthenticated, searchForQueryAction, searchActions, navigationActions, jobActions, quickActions]);

  return {
    actions,
    filterOptions,
    isLoading: isSearchLoading,
  };
}

