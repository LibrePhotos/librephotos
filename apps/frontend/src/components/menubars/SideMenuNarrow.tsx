import {
  ActionIcon,
  Center,
  Loader,
  Menu,
  Progress,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconBook as Book,
  IconChevronRight as ChevronRight,
  IconCloud as Cloud,
  IconHeart as Heart,
} from "@tabler/icons-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchImageTagQuery, useFetchStorageStatsQuery } from "../../api_client/server";
import { useAuth } from "../../hooks/useAuth";
import { DOCUMENTATION_LINK, SUPPORT_LINK } from "../../ui-constants";
import { getNavigationItems } from "./navigation";
import classes from "./SideMenuNarrow.module.css";

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}

export function SideMenuNarrow(): JSX.Element {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [active, setActive] = useState("/");
  const { data: storageStats, isLoading } = useFetchStorageStatsQuery();
  const { data: imageInfos } = useFetchImageTagQuery();
  const { colors } = useMantineTheme();
  const computedTheme = useComputedColorScheme("light");
  const defaultIconColor = computedTheme === "dark" ? colors.gray[3] : colors.dark[9];
  const location = useLocation();

  const { t } = useTranslation();
  const matches = useMediaQuery("(min-width: 700px)");

  // Update active state when location changes
  useEffect(() => {
    setActive(location.pathname);
  }, [location.pathname]);

  if (!matches) {
    return <div />;
  }

  const links = getNavigationItems(t, isAuthenticated).map(item => {
    if (item.display === false) {
      return null;
    }

    // Check if this menu item or any submenu item is active
    const isSubmenuItemActive = item.submenu?.some(subitem => subitem.link && active.startsWith(subitem.link));
    const isItemActive = item.link === active || isSubmenuItemActive;

    const link = (
      <a
        className={classes.link}
        data-active={isItemActive}
        href={item.link}
        key={item.label}
        onClick={event => {
          event.preventDefault();
          if (!item.submenu) {
            setActive(item.link);
            navigate({ to: item.link });
          }
        }}
      >
        <ActionIcon
          component="span"
          className={classes.link_icon}
          color={item.color ? item.color : defaultIconColor}
          variant="light"
        >
          <item.icon />
        </ActionIcon>
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
              const onClick = (event: { preventDefault: () => void }) => {
                event.preventDefault();
                setActive(subitem.link!);
                navigate({ to: subitem.link! });
              };
              const icon = (
                <ActionIcon component="span" variant="light" color={subitem.color ? subitem.color : defaultIconColor}>
                  <subitem.icon />
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

  return (
    <nav className={classes.nav}>
      <div className={classes.links}>{links}</div>
      <div className={classes.bottom_links}>
        <div className={classes.link} data-hover="no">
          <ActionIcon className={classes.link_icon} variant="transparent" color={defaultIconColor}>
            <Cloud />
          </ActionIcon>
          <span>{t("storage")}</span>
        </div>
        {isLoading && (
          <Center>
            <Loader size="xs" />
          </Center>
        )}
        {!isLoading && storageStats && (
          <Tooltip
            label={t("storagetooltip", {
              usedstorage: formatBytes(storageStats.used_storage),
              totalstorage: formatBytes(storageStats.total_storage),
            })}
          >
            <Progress
              className={classes.progress}
              value={(storageStats.used_storage / storageStats.total_storage) * 100}
              color="grey"
            />
          </Tooltip>
        )}
        <div className={classes.link} data-hover="no">
          <Tooltip label={`Backend Version: ${imageInfos?.git_hash}`}>
            <span>{t("version", { version: imageInfos?.image_tag || "dev" })}</span>
          </Tooltip>
        </div>
        <a href={DOCUMENTATION_LINK} target="_blank" rel="noreferrer" className={classes.link}>
          <ActionIcon className={classes.link_icon} variant="transparent">
            <Book />
          </ActionIcon>
          {t("docs")}
        </a>
        <a href={SUPPORT_LINK} target="_blank" rel="noreferrer" className={classes.link}>
          <ActionIcon className={classes.link_icon} variant="transparent" color="pink">
            <Heart />
          </ActionIcon>
          {t("supportus")}
        </a>
      </div>
    </nav>
  );
}
