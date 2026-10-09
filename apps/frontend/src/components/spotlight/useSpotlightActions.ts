import { Avatar, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import type { SpotlightActionData, SpotlightActionGroupData } from "@mantine/spotlight";
import {
  IconAlbum,
  IconBook,
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
  IconLanguage,
  IconLock,
  IconMap,
  IconMoodSmile,
  IconMoon,
  IconPhoto,
  IconPhotoX,
  IconRefresh,
  IconRefreshDot,
  IconRobot,
  IconScreenshot,
  IconSearch,
  IconSettings,
  IconShare,
  IconShield,
  IconSparkles,
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
import { fetchClient } from "../../api_client/api";
import { serverAddress } from "../../api_client/apiClient";
import { useAccessToken } from "../../api_client/auth";
import { useTrainFacesMutation } from "../../api_client/faces";
import {
  useGenerateAutoAlbumsMutation,
  useRescanPhotosMutation,
  useScanPhotosMutation,
  useWorkerQuery,
} from "../../api_client/jobs/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useAuth } from "../../hooks/useAuth";
import { notification } from "../../service/notifications";
import { SearchOptionType, useSearch, type SearchOption } from "../../service/use-search";

const ICON_SIZE = 20;
// Module-level so the useMemo action lists below do not depend on a per-render object.
const iconProps = { size: ICON_SIZE, stroke: 1.5 };
// Also the width of every action's left section, see Spotlight.tsx
export const AVATAR_SIZE = 28;
// With nothing typed, a few suggestions are enough: the commands below them must show too
const EMPTY_QUERY_SEARCH_SUGGESTIONS = 3;

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
        return () => navigate({ to: `/search/${encodeURIComponent(option.data ?? option.value)}` });
      case SearchOptionType.USER_ALBUM:
        return () => navigate({ to: `/album/user/${option.data}` });
      case SearchOptionType.PLACE_ALBUM:
        return () => navigate({ to: `/album/places/${option.data}` });
      case SearchOptionType.THING_ALBUM:
        return () => navigate({ to: `/album/things/${option.data}` });
      case SearchOptionType.PEOPLE:
        return () => navigate({ to: `/album/persons/${option.data}` });
      default:
        return () => navigate({ to: `/search/${encodeURIComponent(option.value)}` });
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
  const { data: auth } = useAccessToken();
  const isAdmin = auth?.access?.is_admin ?? false;
  const { data: userSelfDetails, isPending: isUserSelfDetailsPending } = useCurrentUserSelfDetailsQuery();
  const { toggleColorScheme } = useMantineColorScheme();
  // The raw scheme is "auto" on the default setting; the computed one says which
  // theme is showing, so the toggle offers the other one.
  const colorScheme = useComputedColorScheme("light", { getInitialValueInEffect: false });
  const { options: searchOptions, filterOptions, isLoading: isSearchLoading } = useSearch();

  // Worker and mutation hooks - only query when authenticated
  const { data: worker } = useWorkerQuery({ enabled: isAuthenticated });
  const workerAvailable = worker?.queue_can_accept_job ?? false;

  const scanPhotos = useScanPhotosMutation();
  const rescanPhotos = useRescanPhotosMutation();
  const { mutate: generateAutoAlbums } = useGenerateAutoAlbumsMutation();
  const trainFaces = useTrainFacesMutation();
  // Deleting missing photos drops their records for good, so it asks first, as on the Library page
  const [deleteMissingConfirmOpen, setDeleteMissingConfirmOpen] = useState(false);

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
        id: "nav-memories",
        label: t("spotlight.nav.memories"),
        leftSection: React.createElement(IconSparkles, iconProps),
        onClick: () => navigate({ to: "/memories" }),
        keywords: ["memories", "on this day", "years ago", "anniversary", "rediscover"],
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
        id: "nav-tags",
        label: t("spotlight.nav.tags"),
        leftSection: React.createElement(IconTag, iconProps),
        onClick: () => navigate({ to: "/album/tags" }),
        keywords: ["tags", "keywords", "labels"],
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
        id: "nav-screenshots",
        label: t("spotlight.nav.screenshots"),
        leftSection: React.createElement(IconScreenshot, iconProps),
        onClick: () => navigate({ to: "/screenshots" }),
        keywords: ["screenshots", "screen captures", "screengrabs"],
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
      // The admin area is for superusers only, as in the profile menu
      ...(isAdmin
        ? [
            {
              id: "nav-admin",
              label: t("spotlight.nav.admin"),
              leftSection: React.createElement(IconShield, iconProps),
              onClick: () => navigate({ to: "/admin" }),
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
        keywords: ["face", "recognition", "cluster", "clustering", "unknown faces"],
      },
      {
        id: "nav-settings-llm",
        label: t("spotlight.nav.llmSettings"),
        description: t("spotlight.nav.llmSettingsDesc"),
        leftSection: React.createElement(IconRobot, iconProps),
        onClick: () => navigate({ to: "/settings" }),
        keywords: ["caption", "context", "ai", "names", "places", "llm"],
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
    [t, navigate, isAdmin]
  );

  // Job actions
  const jobActions: SpotlightAction[] = useMemo(() => {
    // Same check as the Library page: a scan without a scan directory fails, so
    // send admins to set one up there and tell everyone else who can
    const guardScan = (run: () => void) => {
      // Until the user details load, a configured user looks like one without a
      // scan directory, so do nothing rather than redirect them
      if (isUserSelfDetailsPending) {
        return;
      }
      if (userSelfDetails?.scan_directory) {
        run();
      } else if (isAdmin) {
        navigate({ to: "/library" });
        // The Library page opens the setup from its own Scan button, so say why the scan did not start
        showNotification({
          title: t("toasts.scanphotostitle"),
          message: t("toasts.scan_directory_setup"),
          color: "orange",
        });
      } else {
        notification.scanDirectoryRequired();
      }
    };
    return [
      {
        id: "action-scan",
        label: t("spotlight.actions.scanPhotos"),
        description: workerAvailable ? undefined : t("topmenu.busy"),
        leftSection: React.createElement(IconRefresh, iconProps),
        onClick: () => {
          if (workerAvailable) {
            guardScan(() => scanPhotos.mutate());
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
            guardScan(() => rescanPhotos.mutate());
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
            fetchClient
              .get("/scanfaces")
              .then(() => notification.rescanFaces())
              .catch(() => notification.rescanFacesFailed());
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
            setDeleteMissingConfirmOpen(true);
          }
        },
        disabled: !workerAvailable,
        keywords: ["delete", "missing", "cleanup"],
      },
    ];
  }, [
    t,
    workerAvailable,
    scanPhotos,
    rescanPhotos,
    trainFaces,
    generateAutoAlbums,
    userSelfDetails,
    isUserSelfDetailsPending,
    isAdmin,
    navigate,
  ]);

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
    () => searchOptions.map(option => searchOptionToAction(option, navigate)),
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
      allSearchActions.push(...searchActions);
    } else {
      allSearchActions.push(...searchActions.slice(0, EMPTY_QUERY_SEARCH_SUGGESTIONS));
    }

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
    deleteMissingConfirm: {
      opened: deleteMissingConfirmOpen,
      close: () => setDeleteMissingConfirmOpen(false),
    },
  };
}
