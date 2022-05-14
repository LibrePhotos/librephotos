import { Button, Divider, Group, Loader, Menu, Stack, Text, Title } from "@mantine/core";
import { push } from "connected-react-router";
import React, { ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, CaretDown, Clock, EyeOff, Globe, Photo, Star } from "tabler-icons-react";

import { useAppDispatch, useAppSelector } from "../../store/store";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { ModalScanDirectoryEdit } from "../modals/ModalScanDirectoryEdit";

type Props = {
  loading: boolean;
  numPhotosetItems: number;
  numPhotos: number;
  noResultsMessage: string;
  icon: ReactElement;
  title: string;
  additionalSubHeader: string;
  dayHeaderPrefix: string;
  date: string;
};

export const DefaultHeader = (props: Props) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState({});

  const auth = useAppSelector(state => state.auth);
  const user = useAppSelector(store => store.user.userSelfDetails);
  const route = useAppSelector(store => store.router);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  // return true if it is a view with a dropdown
  const isMenuView = () => {
    // @ts-ignore
    const path = route.location.pathname;
    return (
      path === "/" ||
      path.startsWith("/hidden") ||
      path.startsWith("/favorites") ||
      path.startsWith("/notimestamp") ||
      path.startsWith("/recent") ||
      path.startsWith("/user/")
    );
  };

  const {
    loading,
    numPhotosetItems,
    icon,
    noResultsMessage,
    numPhotos,
    title,
    additionalSubHeader,
    date,
    dayHeaderPrefix,
  } = props;

  if (loading || numPhotosetItems < 1) {
    return (
      <div>
        <Title order={4}>
          <Group>
            {!loading && auth.access && auth.access.is_admin && !user.scan_directory && numPhotosetItems < 1 ? (
              <div>
                <p>{t("defaultheader.setup")}</p>
                <Button
                  color="green"
                  onClick={() => {
                    setUserToEdit(user);
                    setModalOpen(true);
                  }}
                >
                  {t("defaultheader.gettingstarted")}
                </Button>
              </div>
            ) : loading ? (
              t("defaultheader.loading")
            ) : (
              t("defaultheader.noimages")
            )}
            {loading ? <Loader size={25} /> : null}
          </Group>
        </Title>
        {numPhotosetItems < 1 ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: window.innerHeight - TOP_MENU_HEIGHT - 60,
            }}
          >
            <Title>{noResultsMessage}</Title>
          </div>
        ) : (
          <div />
        )}
        <ModalScanDirectoryEdit
          onRequestClose={() => {
            setModalOpen(false);
          }}
          userToEdit={userToEdit}
          isOpen={modalOpen}
          updateAndScan
        />
      </div>
    );
  }

  return (
    <Group position="apart">
      <Group position="left">
        {icon}
        <div>
          {auth.access && isMenuView() ? (
            <Menu
              trigger="hover"
              control={
                <Title align="left" order={2}>
                  {title} <CaretDown size={20} />
                </Title>
              }
            >
              <Menu.Item icon={<Calendar color="green" size={14} />} onClick={() => dispatch(push("/"))}>
                {t("sidemenu.withtimestamp")}
              </Menu.Item>
              <Menu.Item icon={<Calendar color="red" size={14} />} onClick={() => dispatch(push("/notimestamp"))}>
                {t("sidemenu.withouttimestamp")}
              </Menu.Item>
              <Divider />

              <Menu.Item icon={<Clock size={14} />} onClick={() => dispatch(push("/recent"))}>
                {t("sidemenu.recentlyadded")}
              </Menu.Item>
              <Divider />

              <Menu.Item icon={<EyeOff color="red" size={14} />} onClick={() => dispatch(push("/hidden"))}>
                {t("sidemenu.hidden")}
              </Menu.Item>
              <Menu.Item icon={<Star color="yellow" size={14} />} onClick={() => dispatch(push("/favorites"))}>
                {t("sidemenu.favorites")}
              </Menu.Item>
              <Menu.Item
                icon={<Globe color="green" size={14} />}
                disabled={!auth.access}
                onClick={() => dispatch(push(auth.access ? `/user/${auth.access.name}` : "/"))}
              >
                {t("sidemenu.mypublicphotos")}
              </Menu.Item>
            </Menu>
          ) : (
            <Title align="left" order={2}>
              {title}
            </Title>
          )}
          <Text align="left" color="dimmed">
            {numPhotosetItems != numPhotos ? `${numPhotosetItems} ${t("defaultheader.days")}, ` : ""}
            {numPhotos} {t("defaultheader.photos")}{" "}
          </Text>
          {additionalSubHeader}
        </div>
      </Group>
      <Group position="right">
        <Text>
          <b>{dayHeaderPrefix ? dayHeaderPrefix + date : date}</b>
        </Text>
      </Group>
    </Group>
  );
};
