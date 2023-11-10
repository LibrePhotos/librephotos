import { ActionIcon, Center, Loader, Menu, Navbar, Progress, Tooltip } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { push } from "redux-first-history";
import { Book, ChevronRight, Cloud, Heart } from "tabler-icons-react";

import { useFetchStorageStatsQuery } from "../../api_client/api";
import { selectAuthAccess, selectIsAuthenticated } from "../../store/auth/authSelectors";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { DOCUMENTATION_LINK, LEFT_MENU_WIDTH, SUPPORT_LINK } from "../../ui-constants";
import { getNavigationItems, navigationStyles } from "./navigation";

function formatBytes(bytes, decimals = 2) {
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
  const { classes, cx } = navigationStyles();
  const [active, setActive] = useState("/");

  const { data: storageStats, isLoading } = useFetchStorageStatsQuery();

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
        className={cx(classes.link, { [classes.linkActive]: item.link === active })}
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
        <ActionIcon component="span" className={classes.linkIcon} color={item.color} variant="light">
          <item.icon />
        </ActionIcon>
        <span style={{ flexGrow: 2 }}>{item.label}</span>
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
                return <Menu.Label key={idx}>{subitem.header}</Menu.Label>;
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
                <ActionIcon component="span" color={subitem.color} variant="light">
                  <subitem.icon />
                </ActionIcon>
              );
              return (
                <Menu.Item key={idx} onClick={onClick} icon={icon}>
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
    <Navbar width={{ xs: LEFT_MENU_WIDTH }} pt="md">
      <Navbar.Section grow>{links}</Navbar.Section>

      <Navbar.Section mb="lg">
        <div className={classes.hover}>
          <div className={classes.text} style={{ paddingBottom: 0 }}>
            <ActionIcon className={classes.linkIcon} variant="light">
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
                sections={[{ value: (storageStats.used_storage / storageStats.total_storage) * 100, color: "grey" }]}
              />
            </Tooltip>
          )}
        </div>
        <a href={DOCUMENTATION_LINK} target="_blank" rel="noreferrer" className={classes.link}>
          <ActionIcon className={classes.linkIcon} variant="light">
            <Book />
          </ActionIcon>
          <span style={{ flexGrow: 2 }}>{t("docs")}</span>
        </a>
        <a href={SUPPORT_LINK} target="_blank" rel="noreferrer" className={classes.link}>
          <ActionIcon className={classes.linkIcon} color="pink" variant="light">
            <Heart />
          </ActionIcon>
          <span style={{ flexGrow: 2 }}>{t("supportus")}</span>
        </a>
      </Navbar.Section>
    </Navbar>
  );
}
