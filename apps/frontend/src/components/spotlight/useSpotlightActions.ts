import { Avatar, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type { SpotlightActionData } from "@mantine/spotlight";
import {
  IconAlbum,
  IconCalendarEvent,
  IconFaceId,
  IconMap,
  IconMoodSmile,
  IconMoon,
  IconPhoto,
  IconPhotoX,
  IconRefresh,
  IconRefreshDot,
  IconSearch,
  IconSun,
  IconTag,
  IconUser,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth";
import { useRescanFacesMutation, useTrainFacesMutation } from "../../api_client/faces";
import {
  useGenerateAutoAlbumsMutation,
  useRescanPhotosMutation,
  useScanPhotosMutation,
  useWorkerQuery,
} from "../../api_client/jobs/hooks";
import { mediaUrl } from "../../api_client/media/mediaUrl";
import { serverAddress } from "../../api_client/urls";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useAuth } from "../../hooks/useAuth";
import { notification } from "../../service/notifications";
import { SearchOptionType, useSearch, type SearchOption } from "../../service/useSearch";
import { getNavigationActions, ICON_SIZE, iconProps } from "./navigationActions";

// Also the width of every action's left section, see Spotlight.tsx
export const AVATAR_SIZE = 28;
// With nothing typed, a few suggestions are enough: the commands below them must show too
const EMPTY_QUERY_SEARCH_SUGGESTIONS = 3;

/** An action of the palette. It does the same however it is picked, so onClick takes no event. */
export type SpotlightAction = Omit<SpotlightActionData, "onClick"> & {
  onClick: () => void;
  keywords?: string[];
};

/** A group of actions, as Mantine's SpotlightActionGroupData holds them. */
type SpotlightActionGroup = { group: string; actions: SpotlightAction[] };

function getThumbnailUrl(imageHash: string | undefined): string | undefined {
  if (!imageHash) return undefined;
  return mediaUrl.squareThumbnailSmall(imageHash);
}

function getFaceUrl(faceUrl: string | undefined): string | undefined {
  if (!faceUrl) return undefined;
  // face_url is already a path like /media/faces/...
  return faceUrl.startsWith("http") ? faceUrl : `${serverAddress}${faceUrl}`;
}

function searchOptionToAction(option: SearchOption, navigate: ReturnType<typeof useNavigate>): SpotlightAction {
  const getLeftSection = () => {
    // For people, show face avatar. Avatar is polymorphic: createElement needs the element it renders.
    if (option.type === SearchOptionType.PEOPLE && option.thumbnail) {
      return React.createElement(Avatar<"div">, {
        src: getFaceUrl(option.thumbnail),
        size: AVATAR_SIZE,
        radius: "xl",
      });
    }

    // For user albums (my albums) with thumbnails, show album cover
    if (option.type === SearchOptionType.USER_ALBUM && option.thumbnail) {
      return React.createElement(Avatar<"div">, {
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
  const { mutate: rescanFaces } = useRescanFacesMutation();
  // Deleting missing photos drops their records for good, so it asks first, as on the Library page
  const [deleteMissingConfirmOpen, { open: openDeleteMissingConfirm, close: closeDeleteMissingConfirm }] =
    useDisclosure(false);

  // Navigation actions
  const navigationActions: SpotlightAction[] = useMemo(
    () => getNavigationActions(t, navigate, isAdmin),
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
        notification.warning(t("toasts.scan_directory_setup"), { title: t("toasts.scanphotostitle") });
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
            rescanFaces();
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
            openDeleteMissingConfirm();
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
    rescanFaces,
    generateAutoAlbums,
    userSelfDetails,
    isUserSelfDetailsPending,
    isAdmin,
    navigate,
    openDeleteMissingConfirm,
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
  const actions: SpotlightActionGroup[] = useMemo(() => {
    const groups: SpotlightActionGroup[] = [];

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
      close: () => closeDeleteMissingConfirm(),
    },
  };
}
