import type { UserAlbumInfo } from "@librephotos/api-client";
import { Menu, Text, UnstyledButton } from "@mantine/core";
import { IconAdjustmentsHorizontal, IconCheck, IconLibraryPhoto } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useFetchSharedAlbumsWithMeQuery, useFetchUserAlbumsQuery } from "../../api_client/albums/hooks";
import { useFacesReviewCountQuery } from "../../api_client/faces/hooks";
import { STORAGE_KEYS, useStoredState } from "../../util/storage";
import { MediaThumbnail } from "../common/MediaThumbnail";
import { TabCount } from "../common/TabCount";
import { FACES_SEARCH_DEFAULTS } from "../facedashboard/facesTab";
import type { PinnableDestination } from "./pinnedDestinations";
import { PINNABLE_DESTINATIONS } from "./pinnedDestinations";
import classes from "./SideMenuNarrow.module.css";

// How many recently created or shared albums the sidebar lists.
const RECENT_ALBUMS = 5;

type NavRowProps = Readonly<{
  link: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onNavigate: (link: string) => void;
  /** A quiet count after the label (the faces waiting on a pinned Faces row); none at 0. */
  count?: number;
}>;

/** A sidebar row like the sections above it: a real link, so Ctrl/Cmd-click opens a new tab. */
function NavRow({ link, active, icon, label, onNavigate, count }: NavRowProps) {
  return (
    <a
      className={classes.link}
      data-active={active}
      aria-current={active ? "page" : undefined}
      href={link}
      onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        onNavigate(link);
      }}
    >
      <span className={classes.link_icon} aria-hidden>
        {icon}
      </span>
      <Text className={classes.link_text} size="sm" truncate>
        {label}
      </Text>
      {count ? <TabCount count={count} /> : null}
    </a>
  );
}

/** The user's own albums and those shared with them, newest change first (AlbumUser.created_on is auto_now). */
export function useRecentAlbums(): UserAlbumInfo[] {
  const { data: own } = useFetchUserAlbumsQuery();
  const { data: sharedGroups } = useFetchSharedAlbumsWithMeQuery();
  const shared = (sharedGroups ?? []).flatMap(group => group.albums);
  return [...(own ?? []), ...shared].sort((a, b) => b.created_on.localeCompare(a.created_on)).slice(0, RECENT_ALBUMS);
}

/** A row's on/off state: a filled check when shown in the sidebar, an empty box when not. */
function PinState({ on }: Readonly<{ on: boolean }>) {
  return (
    <span className={classes.pin_state} data-on={on} aria-hidden>
      {on && <IconCheck size={12} stroke={3} />}
    </span>
  );
}

type Props = Readonly<{
  pathname: string;
  pinned: readonly PinnableDestination[];
  activePinned: string | null;
  isPinned: (id: PinnableDestination["id"]) => boolean;
  onTogglePin: (id: PinnableDestination["id"]) => void;
  /** useRecentAlbums(), read by the sidebar too to mark only the deepest row. */
  recentAlbums: UserAlbumInfo[];
}>;

/**
 * Below the sidebar's sections: the pages the user pinned, their recent albums (as Apple Photos
 * lists albums with small covers), and the menu that picks what is pinned.
 */
/** Whether the sidebar lists the recent albums (the customize menu's switch), kept in this browser. */
export function useShowRecentAlbums() {
  return useStoredState(STORAGE_KEYS.sidebarRecentAlbums, z.boolean(), true);
}

export function SidebarExtras({
  pathname,
  pinned,
  activePinned,
  isPinned,
  onTogglePin,
  recentAlbums: allRecentAlbums,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showRecent, setShowRecent] = useShowRecentAlbums();
  const recentAlbums = showRecent ? allRecentAlbums : [];
  const go = (link: string) => void navigate({ to: link });
  // Asked only while Faces is pinned: the default sidebar shows no count
  const { data: facesToReview } = useFacesReviewCountQuery({
    method: FACES_SEARCH_DEFAULTS.method,
    minConfidence: FACES_SEARCH_DEFAULTS.minConfidence,
    enabled: pinned.some(destination => destination.id === "faces"),
  });

  return (
    <>
      {pinned.length > 0 && (
        <div className={classes.group}>
          <Text className={classes.group_label}>{t("sidemenu.pinned")}</Text>
          {pinned.map(destination => (
            <NavRow
              key={destination.id}
              link={destination.link}
              active={activePinned === destination.link}
              icon={<destination.icon size={20} stroke={1.75} />}
              label={t(destination.label)}
              onNavigate={go}
              count={destination.id === "faces" ? facesToReview : undefined}
            />
          ))}
        </div>
      )}
      {recentAlbums.length > 0 && (
        <div className={classes.group}>
          <Text className={classes.group_label}>{t("sidemenu.recentalbums")}</Text>
          {recentAlbums.map(album => {
            const link = `/album/user/${album.id}`;
            const cover = album.cover_photo?.image_hash;
            return (
              <NavRow
                key={album.id}
                link={link}
                active={pathname === link}
                icon={
                  cover ? (
                    <MediaThumbnail
                      imageHash={cover}
                      size={20}
                      video={album.cover_photo?.video === true}
                      radius={4}
                      alt=""
                    />
                  ) : (
                    <IconLibraryPhoto size={20} stroke={1.75} />
                  )
                }
                label={album.title}
                onNavigate={go}
              />
            );
          })}
        </div>
      )}
      <Menu position="right-start" offset={8} width={240} closeOnItemClick={false}>
        <Menu.Target>
          <UnstyledButton className={`${classes.link} ${classes.customize}`}>
            <span className={classes.link_icon} aria-hidden>
              <IconAdjustmentsHorizontal size={20} stroke={1.75} />
            </span>
            <Text className={classes.link_text} size="sm">
              {t("sidemenu.customize")}
            </Text>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{t("sidemenu.pinpages")}</Menu.Label>
          {PINNABLE_DESTINATIONS.map(destination => (
            <Menu.Item
              key={destination.id}
              role="menuitemcheckbox"
              aria-checked={isPinned(destination.id)}
              leftSection={<destination.icon size={16} stroke={1.75} />}
              rightSection={<PinState on={isPinned(destination.id)} />}
              onClick={() => onTogglePin(destination.id)}
            >
              {t(destination.label)}
            </Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item
            role="menuitemcheckbox"
            aria-checked={showRecent}
            leftSection={<IconLibraryPhoto size={16} stroke={1.75} />}
            rightSection={<PinState on={showRecent} />}
            onClick={() => setShowRecent(previous => !previous)}
          >
            {t("sidemenu.recentalbums")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </>
  );
}
