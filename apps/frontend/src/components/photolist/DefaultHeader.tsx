import { Box, Button, Center, Group, Loader, Menu, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import {
  IconCalendar as Calendar,
  IconChevronDown as ChevronDown,
  IconClock as Clock,
  IconEyeOff as EyeOff,
  IconFolderSearch,
  IconGlobe as Globe,
  IconPhoto as Photo,
  IconStar as Star,
  IconVideo as Video,
} from "@tabler/icons-react";
import { DateTime } from "luxon";
import type { ReactElement } from "react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useAccessToken } from "../../api_client/auth/hooks";
import { useFetchUserListQuery, useFetchUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { i18nResolvedLanguage } from "../../i18n";
import { ModalUserEdit } from "../modals/ModalUserEdit";

type Props = Readonly<{
  loading: boolean;
  numPhotosetItems: number;
  numPhotos: number;
  icon: ReactElement;
  title: string;
  additionalSubHeader: React.ReactNode;
  dayHeaderPrefix: string;
  date: string;
  hasEmptyState?: boolean;
}>;

export function DefaultHeader(props: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState({});
  const navigate = useNavigate();
  const router = useRouter();
  const {data: auth} = useAccessToken();
  const {data: userSelfDetails} = useFetchUserSelfDetailsQuery(auth?.access?.user_id ?? '');
  const {data: userList} = useFetchUserListQuery();   
  const {location} = router.state;

  const { t } = useTranslation();

  // return true if it is a view with a dropdown
  const isMenuView = () => {
    // @ts-ignore
    const path = location.pathname;
    return (
      path === "/" ||
      path.startsWith("/hidden") ||
      path.startsWith("/favorites") ||
      path.startsWith("/notimestamp") ||
      path.startsWith("/recent") ||
      path.startsWith("/user/") ||
      path.startsWith("/photos") ||
      path.startsWith("/videos")
    );
  };

  const isScanView = () => location.pathname === "/";

  const { loading, numPhotosetItems, icon, numPhotos, title, additionalSubHeader, date, dayHeaderPrefix, hasEmptyState } = props;

  function getPhotoCounter() {
    if (loading) {
      return (
        <Text ta="left" c="dimmed">
          {t("defaultheader.loading")}
          <Loader size={20} />
        </Text>
      );
    }

    if (numPhotosetItems < 1) {
      // Don't show "No images found" if an EmptyState will be displayed below
      if (hasEmptyState) {
        return null;
      }
      return (
        <Text ta="left" c="dimmed">
          {t("defaultheader.noimages")}
        </Text>
      );
    }

    return (
      <div>
        <Text ta="left" c="dimmed">
          {numPhotosetItems !== numPhotos ? `${numPhotosetItems} ${t("defaultheader.days")}, ` : ""}
          {numPhotos} {t("defaultheader.photos")}
        </Text>
        {additionalSubHeader}
      </div>
    );
  }

  if (!loading && auth?.access && isScanView() && auth.access.is_admin && !userSelfDetails?.scan_directory && numPhotosetItems < 1) {
    return (
      <Center style={{ height: "calc(100vh - 120px)" }}>
        <Stack align="center" gap="lg">
          <ThemeIcon size={80} radius="xl" variant="light" color="green">
            <IconFolderSearch size={45} />
          </ThemeIcon>
          <Box ta="center">
            <Title order={2} mb="xs">{t("defaultheader.welcome")}</Title>
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
              setModalOpen(true);
            }}
          >
            {t("defaultheader.gettingstarted")}
          </Button>
          <ModalUserEdit
            onRequestClose={() => {
              setModalOpen(false);
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

  return (
    <div>
      <Group justify="apart">
        <Group justify="left">
          {icon}
          <div>
            {auth?.access && isMenuView() ? (
              <Menu>
                <Menu.Target>
                  <Title style={{ minWidth: 200 }} ta="left" order={2}>
                    {title} <ChevronDown size={20} />
                  </Title>
                </Menu.Target>

                <Menu.Dropdown>
                  <Menu.Item leftSection={<Calendar color="green" size={14} />} onClick={() => navigate({ to: "/" })}>
                    {t("sidemenu.withtimestamp")}
                  </Menu.Item>

                  <Menu.Item
                    leftSection={<Calendar color="red" size={14} />}
                    onClick={() => navigate({ to: "/notimestamp" })}
                  >
                    {t("sidemenu.withouttimestamp")}
                  </Menu.Item>

                  <Menu.Divider />

                  <Menu.Item leftSection={<Clock size={14} />} onClick={() => navigate({ to: "/recent" })}>
                    {t("sidemenu.recentlyadded")}
                  </Menu.Item>

                  <Menu.Divider />

                  <Menu.Item leftSection={<EyeOff color="red" size={14} />} onClick={() => navigate({ to: "/hidden" })}>
                    {t("sidemenu.hidden")}
                  </Menu.Item>

                  <Menu.Item
                    leftSection={<Star color="yellow" size={14} />}
                    onClick={() => navigate({ to: "/favorites" })}
                  >
                    {t("sidemenu.favorites")}
                  </Menu.Item>

                  <Menu.Item leftSection={<Photo color="blue" size={14} />} onClick={() => navigate({ to: "/photos" })}>
                    {t("sidemenu.photos")}
                  </Menu.Item>

                  <Menu.Item leftSection={<Video color="pink" size={14} />} onClick={() => navigate({ to: "/videos" })}>
                    {t("sidemenu.videos")}
                  </Menu.Item>

                  <Menu.Item
                    leftSection={<Globe color="green" size={14} />}
                    disabled={!auth?.access}
                    onClick={() => navigate(auth?.access ? { to: `/user/${auth.access.name}` } : { to: "/" })}
                  >
                    {t("sidemenu.mypublicphotos")}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            ) : (
              <Title ta="left" order={2}>
                {title}
              </Title>
            )}
            {getPhotoCounter()}
          </div>
        </Group>
        {(!hasEmptyState || numPhotosetItems > 0) && (dayHeaderPrefix || date) && (
          <Group justify="right">
            <Text>
              <b>
                {dayHeaderPrefix}
                {DateTime.fromISO(date).isValid
                  ? DateTime.fromISO(date).setLocale(i18nResolvedLanguage()).toLocaleString(DateTime.DATE_HUGE)
                  : date}
              </b>
            </Text>
          </Group>
        )}
      </Group>
    </div>
  );
}
