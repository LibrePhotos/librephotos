import {
  ActionIcon,
  Center,
  Loader,
  Menu,
  Progress,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconBook as Book,
  IconChevronRight as ChevronRight,
  IconCloud as Cloud,
  IconHeart as Heart,
} from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { push } from "redux-first-history";

import { useFetchImageTagQuery, useFetchStorageStatsQuery } from "../../api_client/api";
import { selectAuthAccess, selectIsAuthenticated } from "../../store/auth/authSelectors";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { DOCUMENTATION_LINK, SUPPORT_LINK } from "../../ui-constants";
import { getNavigationItems } from "./navigation";

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}

export function SideMenuNarrow(): JSX.Element {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const canAccess = useAppSelector(selectAuthAccess);
  const dispatch = useAppDispatch();
  const theme = useMantineTheme();
  const { colorScheme } = useMantineColorScheme();
  const [active, setActive] = useState("/");
  const { data: storageStats, isLoading } = useFetchStorageStatsQuery();
  const { data: imageInfos } = useFetchImageTagQuery();
  const { colors } = useMantineTheme();
  const computedTheme = useComputedColorScheme("light");
  const defaultIconColor = computedTheme === "dark" ? colors.gray[3] : colors.dark[9];

  const { t } = useTranslation();
  const matches = useMediaQuery("(min-width: 700px)");

  if (!matches) {
    return <div />;
  }

  const links = getNavigationItems(t, isAuthenticated, canAccess).map(item => {
    if (item.display === false) {
      return null;
    }

    const link = (
      <a
        style={{
          display: "flex",
          alignItems: "center",
          textDecoration: "none",
          fontSize: theme.fontSizes.sm,
          padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
          borderRadius: theme.radius.sm,
          fontWeight: 500,
          color: colorScheme === "dark" ? theme.colors.gray[3] : theme.colors.dark[9],
          "&:hover": {
            backgroundColor: colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[2],
          },
        }}
        data-active={item.link === active}
        href={item.link}
        key={item.label}
        onClick={event => {
          event.preventDefault();
          if (!item.submenu) {
            setActive(item.link);
            dispatch(push(item.link));
          }
        }}
      >
        <ActionIcon
          component="span"
          style={{ marginRight: theme.spacing.sm }}
          color={item.color ? item.color : defaultIconColor}
          variant="light"
        >
          <item.icon />
        </ActionIcon>
        <Text size="sm" style={{ flexGrow: 2 }}>
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
                setActive(item.link);
                dispatch(push(subitem.link!));
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
    <nav
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        height: "100vh",
      }}
    >
      <div style={{ marginTop: theme.spacing.sm, marginBottom: theme.spacing.sm, alignItems: "start" }}>{links}</div>

      <div
        style={{
          paddingBottom: theme.spacing.sm,
          borderTop: colorScheme === "dark" ? `1px solid ${theme.colors.dark[4]}` : `1px solid ${theme.colors.gray[2]}`,
        }}
      >
        <div
          style={{
            paddingBottom: 0,
            display: "flex",
            alignItems: "center",
            textDecoration: "none",
            fontSize: theme.fontSizes.sm,
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
            borderRadius: theme.radius.sm,
            fontWeight: 500,
          }}
        >
          <ActionIcon style={{ marginRight: theme.spacing.sm }} variant="transparent" color={defaultIconColor}>
            <Cloud />
          </ActionIcon>
          <span style={{ flexGrow: 2 }}>{t("storage")}</span>
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
              style={{ margin: 10 }}
              value={(storageStats.used_storage / storageStats.total_storage) * 100}
              color="grey"
            />
          </Tooltip>
        )}
        <div
          style={{
            paddingTop: 0,
            paddingBottom: 0,
            display: "flex",
            alignItems: "center",
            textDecoration: "none",
            fontSize: theme.fontSizes.sm,
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
            borderRadius: theme.radius.sm,
            fontWeight: 500,
          }}
        >
          <Tooltip label={`Backend Version: ${imageInfos?.git_hash}`}>
            <span style={{ flexGrow: 2 }}>
              {imageInfos?.image_tag ? t("version", { version: imageInfos?.image_tag }) : ""}
            </span>
          </Tooltip>
        </div>
        <a
          href={DOCUMENTATION_LINK}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            textDecoration: "none",
            fontSize: theme.fontSizes.sm,
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
            borderRadius: theme.radius.sm,
            fontWeight: 500,
            color: colorScheme === "dark" ? theme.colors.gray[3] : theme.colors.dark[9],
            "&:hover": {
              backgroundColor: colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[2],
            },
          }}
        >
          <ActionIcon style={{ marginRight: theme.spacing.sm }} variant="transparent">
            <Book />
          </ActionIcon>
          <span style={{ flexGrow: 2 }}>{t("docs")}</span>
        </a>
        <a
          href={SUPPORT_LINK}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            textDecoration: "none",
            fontSize: theme.fontSizes.sm,
            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
            borderRadius: theme.radius.sm,
            fontWeight: 500,
            color: colorScheme === "dark" ? theme.colors.gray[3] : theme.colors.dark[9],
            "&:hover": {
              backgroundColor: colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[2],
            },
          }}
        >
          <ActionIcon style={{ marginRight: theme.spacing.sm }} variant="transparent" color="pink">
            <Heart />
          </ActionIcon>
          <span style={{ flexGrow: 2 }}>{t("supportus")}</span>
        </a>
      </div>
    </nav>
  );
}
