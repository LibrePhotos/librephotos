import { ActionIcon, Loader, Menu, Progress, Text, useComputedColorScheme, useMantineTheme } from "@mantine/core";
import {
  IconChevronRight as ChevronRight,
  IconCloud as Cloud,
  IconCopy as Copy,
  IconHeart as Heart,
} from "@tabler/icons-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDuplicateStatsQuery } from "../../api_client/duplicates";
import { useFetchStorageStatsQuery } from "../../api_client/server";
import { useAuth } from "../../hooks/useAuth";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { useIsDesktopLayout } from "../../hooks/useIsDesktopLayout";
import { DOCUMENTATION_LINK, SUPPORT_LINK } from "../../uiConstants";
import { formatFileSize } from "../../util/fileSize";
import { getNavigationItems, isNavItemActive } from "./navigation";
import { activePinnedLink, usePinnedDestinations } from "./pinnedDestinations";
import { SidebarExtras } from "./SidebarExtras";
import classes from "./SideMenuNarrow.module.css";
import { VersionItem } from "./VersionItem";

export function SideMenuNarrow(): React.JSX.Element {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [active, setActive] = useState("/");
  const { data: storageStats, isLoading } = useFetchStorageStatsQuery();
  // The card is a nudge, not a live counter: the duplicate pages and their
  // mutations refresh these stats when it matters.
  const { data: duplicateStats } = useDuplicateStatsQuery({ staleTime: 5 * 60 * 1000 });
  const { colors } = useMantineTheme();
  const computedTheme = useComputedColorScheme("light");
  const defaultIconColor = computedTheme === "dark" ? colors.gray[3] : colors.dark[9];
  const location = useLocation();

  const { t } = useTranslation();
  const locale = useFormatLocale();
  const matches = useIsDesktopLayout();
  const pins = usePinnedDestinations();

  // Update active state when location changes
  useEffect(() => {
    setActive(location.pathname);
  }, [location.pathname]);

  if (!matches) {
    return <div />;
  }

  const activePinned = activePinnedLink(pins.pinned, active);
  const links = getNavigationItems(t, isAuthenticated).map(item => {
    if (item.display === false) {
      return null;
    }

    // Check if this menu item or any submenu item is active
    const isSubmenuItemActive = item.submenu?.some(subitem => subitem.link && active.startsWith(subitem.link));
    // A pinned page the path is on is the one marked, not the section that also holds it.
    const isItemActive = activePinned === null && (isNavItemActive(item, active) || isSubmenuItemActive);

    const link = (
      <a
        className={classes.link}
        data-active={isItemActive}
        aria-current={isItemActive ? "page" : undefined}
        href={item.link}
        key={item.label}
        onClick={event => {
          // Let the browser open Ctrl/Cmd/Shift-clicks in a new tab or window.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
            return;
          }
          event.preventDefault();
          if (!item.submenu) {
            setActive(item.link);
            navigate({ to: item.link });
          }
        }}
      >
        <span className={classes.link_icon} aria-hidden>
          <item.icon size={20} stroke={1.75} />
        </span>
        <Text className={classes.link_text} size="sm">
          {item.label}
        </Text>
        {item.submenu && <ChevronRight size={16} />}
      </a>
    );

    if (item.submenu) {
      return (
        <Menu key={item.label} withArrow position="right-start" width={200}>
          <Menu.Target>{link}</Menu.Target>

          <Menu.Dropdown>
            {item.submenu.map(subitem => {
              const idx = item.submenu?.indexOf(subitem);
              if (subitem.header) {
                return (
                  <Menu.Label color="gray" key={idx}>
                    {subitem.header}
                  </Menu.Label>
                );
              }
              if (subitem.separator) {
                return <Menu.Divider key={idx} />;
              }
              const { icon: SubmenuIcon, link: submenuLink } = subitem;
              const onClick = (event: { preventDefault: () => void }) => {
                event.preventDefault();
                if (submenuLink === undefined) {
                  return;
                }
                setActive(submenuLink);
                navigate({ to: submenuLink });
              };
              const icon = (
                <ActionIcon component="span" variant="light" color={subitem.color ? subitem.color : defaultIconColor}>
                  {SubmenuIcon && <SubmenuIcon />}
                </ActionIcon>
              );
              return (
                <Menu.Item key={idx} onClick={onClick} leftSection={icon}>
                  {subitem.label}
                </Menu.Item>
              );
            })}
          </Menu.Dropdown>
        </Menu>
      );
    }

    return link;
  });

  const pendingDuplicates = duplicateStats?.pending_duplicates ?? 0;
  const showCleanupCard = isAuthenticated && pendingDuplicates > 0 && !active.startsWith("/organizing");

  const usedStoragePercent = storageStats?.total_storage
    ? (storageStats.used_storage / storageStats.total_storage) * 100
    : 0;

  // The icons are spans (as in the links above): the row is the control, so
  // they are neither tab stops nor buttons nested in the anchors. The labels
  // use the same Text as the links above so weight and alignment match.
  return (
    <nav className={classes.nav}>
      <div className={classes.links}>
        {links}
        {isAuthenticated && (
          <SidebarExtras
            pathname={active}
            pinned={pins.pinned}
            activePinned={activePinned}
            isPinned={pins.isPinned}
            onTogglePin={pins.toggle}
          />
        )}
      </div>
      <div className={classes.bottom_links}>
        {showCleanupCard && (
          <a
            className={classes.cleanup}
            href="/organizing/duplicates"
            onClick={event => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                return;
              }
              event.preventDefault();
              navigate({ to: "/organizing/$tab", params: { tab: "duplicates" } });
            }}
          >
            <Text size="sm" fw={500} className={classes.cleanup_title}>
              <Copy size={16} />
              {t("sidemenu.cleanup.title", { count: pendingDuplicates })}
            </Text>
            {duplicateStats && duplicateStats.potential_savings_bytes > 0 && (
              <Text size="xs">
                {t("sidemenu.cleanup.savings", {
                  size: formatFileSize(duplicateStats.potential_savings_bytes, locale),
                })}
              </Text>
            )}
          </a>
        )}
        {/* Storage as a quiet card, like the storage meter at the bottom of Google Photos' and
            Immich's navigation: the numbers are on the card, not in a tooltip. */}
        <div className={classes.storage}>
          <Text size="sm" fw={500} className={classes.storage_title}>
            <Cloud size={18} stroke={1.75} aria-hidden />
            {t("storage")}
          </Text>
          {isLoading && <Loader size="xs" />}
          {!isLoading && storageStats && (
            <>
              <Progress
                size="sm"
                value={usedStoragePercent}
                // Warn before the disk fills up and scans or uploads start failing.
                color={usedStoragePercent >= 90 ? "red" : usedStoragePercent >= 75 ? "orange" : undefined}
                aria-label={t("storage")}
              />
              <Text size="xs" c="dimmed">
                {t("storagetooltip", {
                  usedstorage: formatFileSize(storageStats.used_storage, locale),
                  totalstorage: formatFileSize(storageStats.total_storage, locale),
                })}
              </Text>
            </>
          )}
        </div>
        {/* Version, docs and support as one quiet line, as Immich ends its sidebar with a status
            line: secondary to the navigation above. */}
        <div className={classes.footer_line}>
          <VersionItem />
          <span aria-hidden>·</span>
          <a href={DOCUMENTATION_LINK} target="_blank" rel="noreferrer" className={classes.footer_link}>
            {t("docs")}
          </a>
          <span aria-hidden>·</span>
          <a href={SUPPORT_LINK} target="_blank" rel="noreferrer" className={classes.footer_link}>
            <Heart size={12} stroke={2} aria-hidden />
            {t("supportus")}
          </a>
        </div>
      </div>
    </nav>
  );
}
