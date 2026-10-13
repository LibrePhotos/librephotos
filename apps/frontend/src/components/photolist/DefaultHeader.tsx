import type { User } from "@librephotos/api-client";
import {
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Menu,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
  useMantineTheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconCalendar as Calendar,
  IconCheck as Check,
  IconChevronDown as ChevronDown,
  IconClock as Clock,
  IconCopy as Copy,
  IconEyeOff as EyeOff,
  IconFileText as FileText,
  IconGlobe as Globe,
  IconFolderSearch,
  IconMapPinOff as MapPinOff,
  IconPhoto as Photo,
  IconScreenshot as Screenshot,
  IconSparkles as Sparkles,
  IconLayersSubtract as Stacks,
  IconStar as Star,
  IconVideo as Video,
  type TablerIcon,
} from "@tabler/icons-react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { DateTime } from "luxon";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth/hooks";
import { useDuplicateStatsQuery } from "../../api_client/duplicates";
import { useFetchUserListQuery, useFetchUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { FAVORITE_COLOR, ICON_SIZE } from "../../uiConstants";
import { parseInstant } from "../../util/dateUtils";
import { ModalUserEdit } from "../modals/ModalUserEdit";
import { PageHeader } from "../PageHeader";

type Props = Readonly<{
  loading: boolean;
  numPhotosetItems: number;
  numPhotos: number;
  icon: TablerIcon;
  title: string;
  additionalSubHeader: React.ReactNode;
  dayHeaderPrefix?: string;
  date?: string;
  hasEmptyState?: boolean;
  isPublic?: boolean;
  // Count the items as videos rather than photos (the Videos view and the
  // videos-only media filter).
  countsVideos?: boolean;
  // See PhotoListView's `titleOrder`.
  titleOrder?: 1 | 2;
  // A line under the count saying what the page's media filter shows; also
  // shown when the filter matches nothing.
  filterHint?: React.ReactNode;
}>;

type PhotoCounterProps = Readonly<
  Pick<
    Props,
    | "loading"
    | "numPhotosetItems"
    | "numPhotos"
    | "hasEmptyState"
    | "countsVideos"
    | "filterHint"
    | "additionalSubHeader"
  >
>;

// The subtitle: loading, "No images found", or the day and photo counts, with
// the media filter's hint and the page's own sub-header.
function PhotoCounter({
  loading,
  numPhotosetItems,
  numPhotos,
  hasEmptyState,
  countsVideos,
  filterHint,
  additionalSubHeader,
}: PhotoCounterProps) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <Group gap={6} wrap="nowrap">
        <Text ta="left" c="dimmed">
          {t("defaultheader.loading")}
        </Text>
        <Loader size="xs" />
      </Group>
    );
  }

  if (numPhotosetItems < 1) {
    // Don't show "No images found" if an EmptyState will be displayed below
    if (hasEmptyState) {
      return null;
    }
    return (
      <div>
        <Text ta="left" c="dimmed">
          {t("defaultheader.noimages")}
        </Text>
        {filterHint}
      </div>
    );
  }

  return (
    <div>
      <Text ta="left" c="dimmed">
        {numPhotosetItems !== numPhotos
          ? `${numPhotosetItems} ${t("defaultheader.days", { count: numPhotosetItems })}, `
          : ""}
        {numPhotos} {t(countsVideos ? "defaultheader.videos" : "defaultheader.photos", { count: numPhotos })}
      </Text>
      {filterHint}
      {additionalSubHeader}
    </div>
  );
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

export function DefaultHeader(props: Props) {
  const [modalOpen, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [userToEdit, setUserToEdit] = useState<Partial<User>>({});
  const navigate = useNavigate();
  const router = useRouter();
  const { data: auth } = useAccessToken();

  const {
    loading,
    numPhotosetItems,
    icon,
    numPhotos,
    title,
    additionalSubHeader,
    date,
    dayHeaderPrefix,
    hasEmptyState,
    isPublic,
    countsVideos,
    titleOrder,
    filterHint,
  } = props;

  // Don't fetch user data on public pages
  const { data: userSelfDetails } = useFetchUserSelfDetailsQuery(isPublic ? "" : (auth?.access?.user_id ?? ""));
  const { data: userList } = useFetchUserListQuery(isPublic);
  const { location } = router.state;

  const { t } = useTranslation();
  const theme = useMantineTheme();

  // return true if it is a view with a dropdown
  const isMenuView = () => {
    const path = location.pathname;
    return (
      path === "/" ||
      path.startsWith("/hidden") ||
      path.startsWith("/favorites") ||
      path.startsWith("/notimestamp") ||
      path.startsWith("/nolocation") ||
      path.startsWith("/recent") ||
      path.startsWith("/user/") ||
      path.startsWith("/photos") ||
      path.startsWith("/videos") ||
      path.startsWith("/screenshots") ||
      path.startsWith("/documents")
    );
  };

  const isScanView = () => location.pathname === "/";

  // The view switcher marks the view the user is on.
  const currentView = (to: string) => (location.pathname === to ? <Check size={ICON_SIZE.menu} /> : null);

  if (
    !loading &&
    auth?.access &&
    isScanView() &&
    auth.access.is_admin &&
    !userSelfDetails?.scan_directory &&
    numPhotosetItems < 1
  ) {
    return (
      <Center style={{ height: "calc(100vh - 120px)" }}>
        <Stack align="center" gap="lg">
          <ThemeIcon size={80} radius="xl" variant="light" color="green">
            <IconFolderSearch size={45} />
          </ThemeIcon>
          <Box ta="center">
            <Title order={2} mb="xs">
              {t("defaultheader.welcome")}
            </Title>
            <Text c="dimmed" size="lg" maw={400}>
              {t("defaultheader.setup")}
            </Text>
          </Box>
          <Button
            size="md"
            color="green"
            leftSection={<Photo size={18} />}
            onClick={() => {
              setUserToEdit({ ...userSelfDetails });
              openModal();
            }}
          >
            {t("defaultheader.gettingstarted")}
          </Button>
          <ModalUserEdit
            onRequestClose={() => {
              closeModal();
            }}
            userToEdit={userToEdit}
            isOpen={modalOpen}
            updateAndScan
            userList={userList}
            createNew={false}
            firstTimeSetup
          />
        </Stack>
      </Center>
    );
  }

  // The view switcher on the views that have one; otherwise the plain title
  const titleNode =
    auth?.access && isMenuView() ? (
      <Menu>
        {/* A real button, so the view switcher is reachable from the keyboard. */}
        <Menu.Target>
          <UnstyledButton style={{ fontSize: "inherit" }}>
            {title} <ChevronDown size={ICON_SIZE.toolbar} style={{ verticalAlign: "middle" }} />
          </UnstyledButton>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item
            leftSection={<Calendar color={theme.colors.green[6]} size={ICON_SIZE.menu} />}
            rightSection={currentView("/")}
            onClick={() => navigate({ to: "/" })}
          >
            {t("sidemenu.photos")}
          </Menu.Item>

          <Menu.Item
            leftSection={<Calendar color={theme.colors.red[6]} size={ICON_SIZE.menu} />}
            rightSection={currentView("/notimestamp")}
            onClick={() => navigate({ to: "/notimestamp" })}
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

          <Menu.Divider />

          <Menu.Item
            leftSection={<Clock size={ICON_SIZE.menu} />}
            rightSection={currentView("/recent")}
            onClick={() => navigate({ to: "/recent" })}
          >
            {t("sidemenu.recentlyadded")}
          </Menu.Item>

          <Menu.Item
            leftSection={<Sparkles color={theme.colors.grape[6]} size={ICON_SIZE.menu} />}
            onClick={() => navigate({ to: "/memories" })}
          >
            {t("sidemenu.memories")}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item
            leftSection={<EyeOff color={theme.colors.red[6]} size={ICON_SIZE.menu} />}
            rightSection={currentView("/hidden")}
            onClick={() => navigate({ to: "/hidden" })}
          >
            {t("sidemenu.hidden")}
          </Menu.Item>

          <Menu.Item
            leftSection={<Star color={FAVORITE_COLOR} size={ICON_SIZE.menu} />}
            rightSection={currentView("/favorites")}
            onClick={() => navigate({ to: "/favorites" })}
          >
            {t("sidemenu.favorites")}
          </Menu.Item>

          <Menu.Item
            leftSection={<Photo color={theme.colors.blue[6]} size={ICON_SIZE.menu} />}
            rightSection={currentView("/photos")}
            onClick={() => navigate({ to: "/photos" })}
          >
            {t("mediafilter.photos")}
          </Menu.Item>

          <Menu.Item
            leftSection={<Video color={theme.colors.pink[6]} size={ICON_SIZE.menu} />}
            rightSection={currentView("/videos")}
            onClick={() => navigate({ to: "/videos" })}
          >
            {t("sidemenu.videos")}
          </Menu.Item>

          <Menu.Item
            leftSection={<Screenshot color={theme.colors.violet[6]} size={ICON_SIZE.menu} />}
            rightSection={currentView("/screenshots")}
            onClick={() => navigate({ to: "/screenshots" })}
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
            disabled={!auth?.access}
            onClick={() =>
              navigate(auth?.access ? { to: "/public/$users", params: { users: auth.access.name } } : { to: "/" })
            }
          >
            {t("sidemenu.mypublicphotos")}
          </Menu.Item>

          <Menu.Divider />
          <Menu.Label>{t("sidemenu.organizing")}</Menu.Label>

          <DuplicatesMenuItem onClick={() => navigate({ to: "/organizing/$tab", params: { tab: "duplicates" } })} />

          <Menu.Item
            leftSection={<Stacks color={theme.colors.yellow[6]} size={ICON_SIZE.menu} />}
            onClick={() => navigate({ to: "/organizing/$tab", params: { tab: "stacks" } })}
          >
            {t("sidemenu.stacks")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    ) : (
      title
    );

  return (
    <PageHeader
      icon={icon}
      title={titleNode}
      titleOrder={titleOrder}
      subtitle={
        <PhotoCounter
          loading={loading}
          numPhotosetItems={numPhotosetItems}
          numPhotos={numPhotos}
          hasEmptyState={hasEmptyState}
          countsVideos={countsVideos}
          filterHint={filterHint}
          additionalSubHeader={additionalSubHeader}
        />
      }
      actions={
        (!hasEmptyState || numPhotosetItems > 0) && date ? (
          <Text style={{ whiteSpace: "nowrap" }}>
            <b>
              {dayHeaderPrefix}
              {parseInstant(date).isValid ? parseInstant(date).toLocaleString(DateTime.DATE_HUGE) : date}
            </b>
          </Text>
        ) : undefined
      }
    />
  );
}
