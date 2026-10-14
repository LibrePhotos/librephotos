import { Badge, Menu, UnstyledButton, useMantineTheme } from "@mantine/core";
import {
  IconAlbumOff as AlbumOff,
  IconArchive as Archive,
  IconCalendar as Calendar,
  IconCheck as Check,
  IconChevronDown as ChevronDown,
  IconClock as Clock,
  IconCopy as Copy,
  IconEyeOff as EyeOff,
  IconFileText as FileText,
  IconGlobe as Globe,
  IconMapPinOff as MapPinOff,
  IconPhoto as Photo,
  IconScreenshot as Screenshot,
  IconSparkles as Sparkles,
  IconLayersSubtract as Stacks,
  IconStar as Star,
  IconVideo as Video,
} from "@tabler/icons-react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDuplicateStatsQuery } from "../../api_client/duplicates";
import { FAVORITE_COLOR, ICON_SIZE } from "../../uiConstants";
import classes from "./PhotosViewSwitcher.module.css";

// The pages whose title is the Photos view switcher.
const SWITCHER_PREFIXES = [
  "/hidden",
  "/archived",
  "/favorites",
  "/notimestamp",
  "/nolocation",
  "/noalbum",
  "/recent",
  "/user/",
  "/photos",
  "/videos",
  "/screenshots",
  "/documents",
];

export function isPhotosView(pathname: string) {
  return pathname === "/" || SWITCHER_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

// Its own component so the stats are only fetched once the dropdown is open.
function DuplicatesMenuItem({ onClick }: Readonly<{ onClick: () => void }>) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const { data: stats } = useDuplicateStatsQuery();
  const pending = stats?.pending_duplicates ?? 0;

  return (
    <Menu.Item
      leftSection={<Copy color={theme.colors.yellow[6]} size={ICON_SIZE.menu} />}
      rightSection={
        pending > 0 ? (
          <Badge size="sm" variant="light" color="yellow" circle={pending < 10}>
            {pending}
          </Badge>
        ) : null
      }
      onClick={onClick}
    >
      {t("sidemenu.duplicates")}
    </Menu.Item>
  );
}

// The page title as a menu of the Photos views, with a check mark on the current one.
// `publicName` is the signed-in user's name, for My Public Photos.
export function PhotosViewSwitcher({ title, publicName }: Readonly<{ title: string; publicName: string }>) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const navigate = useNavigate();
  const { pathname } = useRouter().state.location;
  const currentView = (to: string) => (pathname === to ? <Check size={ICON_SIZE.menu} /> : null);

  return (
    <Menu>
      {/* A real button, so the view switcher is reachable from the keyboard. */}
      <Menu.Target>
        <UnstyledButton fz="inherit">
          {title} <ChevronDown size={ICON_SIZE.toolbar} className={classes.chevron} />
        </UnstyledButton>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Item
          leftSection={<Calendar color={theme.colors.green[6]} size={ICON_SIZE.menu} />}
          rightSection={currentView("/")}
          onClick={() => void navigate({ to: "/" })}
        >
          {t("sidemenu.photos")}
        </Menu.Item>

        <Menu.Item
          leftSection={<Calendar color={theme.colors.red[6]} size={ICON_SIZE.menu} />}
          rightSection={currentView("/notimestamp")}
          onClick={() => void navigate({ to: "/notimestamp" })}
        >
          {t("sidemenu.withouttimestamp")}
        </Menu.Item>

        <Menu.Item
          leftSection={<MapPinOff color={theme.colors.red[6]} size={ICON_SIZE.menu} />}
          rightSection={currentView("/nolocation")}
          onClick={() => void navigate({ to: "/nolocation" })}
        >
          {t("sidemenu.withoutlocation")}
        </Menu.Item>

        <Menu.Item
          leftSection={<AlbumOff color={theme.colors.blue[6]} size={ICON_SIZE.menu} />}
          rightSection={currentView("/noalbum")}
          onClick={() => void navigate({ to: "/noalbum" })}
        >
          {t("sidemenu.notinalbum")}
        </Menu.Item>

        <Menu.Divider />

        <Menu.Item
          leftSection={<Clock size={ICON_SIZE.menu} />}
          rightSection={currentView("/recent")}
          onClick={() => void navigate({ to: "/recent" })}
        >
          {t("sidemenu.recentlyadded")}
        </Menu.Item>

        <Menu.Item
          leftSection={<Sparkles color={theme.colors.grape[6]} size={ICON_SIZE.menu} />}
          onClick={() => void navigate({ to: "/memories" })}
        >
          {t("sidemenu.memories")}
        </Menu.Item>

        <Menu.Divider />

        <Menu.Item
          leftSection={<EyeOff color={theme.colors.red[6]} size={ICON_SIZE.menu} />}
          rightSection={currentView("/hidden")}
          onClick={() => void navigate({ to: "/hidden" })}
        >
          {t("sidemenu.hidden")}
        </Menu.Item>

        <Menu.Item
          leftSection={<Archive color={theme.colors.teal[6]} size={ICON_SIZE.menu} />}
          rightSection={currentView("/archived")}
          onClick={() => void navigate({ to: "/archived" })}
        >
          {t("sidemenu.archive")}
        </Menu.Item>

        <Menu.Item
          leftSection={<Star color={FAVORITE_COLOR} size={ICON_SIZE.menu} />}
          rightSection={currentView("/favorites")}
          onClick={() => void navigate({ to: "/favorites" })}
        >
          {t("sidemenu.favorites")}
        </Menu.Item>

        <Menu.Item
          leftSection={<Photo color={theme.colors.blue[6]} size={ICON_SIZE.menu} />}
          rightSection={currentView("/photos")}
          onClick={() => void navigate({ to: "/photos" })}
        >
          {t("mediafilter.photos")}
        </Menu.Item>

        <Menu.Item
          leftSection={<Video color={theme.colors.pink[6]} size={ICON_SIZE.menu} />}
          rightSection={currentView("/videos")}
          onClick={() => void navigate({ to: "/videos" })}
        >
          {t("sidemenu.videos")}
        </Menu.Item>

        <Menu.Item
          leftSection={<Screenshot color={theme.colors.violet[6]} size={ICON_SIZE.menu} />}
          rightSection={currentView("/screenshots")}
          onClick={() => void navigate({ to: "/screenshots" })}
        >
          {t("sidemenu.screenshots")}
        </Menu.Item>

        <Menu.Item
          leftSection={<FileText color={theme.colors.orange[7]} size={ICON_SIZE.menu} />}
          rightSection={currentView("/documents")}
          onClick={() => void navigate({ to: "/documents" })}
        >
          {t("sidemenu.documents")}
        </Menu.Item>

        <Menu.Item
          leftSection={<Globe color={theme.colors.green[6]} size={ICON_SIZE.menu} />}
          onClick={() => void navigate({ to: "/public/$users", params: { users: publicName } })}
        >
          {t("sidemenu.mypublicphotos")}
        </Menu.Item>

        <Menu.Divider />
        <Menu.Label>{t("sidemenu.organizing")}</Menu.Label>

        <DuplicatesMenuItem onClick={() => void navigate({ to: "/organizing/$tab", params: { tab: "duplicates" } })} />

        <Menu.Item
          leftSection={<Stacks color={theme.colors.yellow[6]} size={ICON_SIZE.menu} />}
          onClick={() => void navigate({ to: "/organizing/$tab", params: { tab: "stacks" } })}
        >
          {t("sidemenu.stacks")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
