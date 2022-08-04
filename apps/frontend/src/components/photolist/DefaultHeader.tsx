import { Button, Divider, Group, Loader, Menu, Text, Title } from "@mantine/core";
import type { ReactElement } from "react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { push } from "redux-first-history";
import { Calendar, ChevronDown, Clock, EyeOff, Globe, Star } from "tabler-icons-react";

import { useFetchUserListQuery } from "../../api_client/api";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { ModalUserEdit } from "../modals/ModalUserEdit";

type Props = {
  loading: boolean;
  numPhotosetItems: number;
  numPhotos: number;
  icon: ReactElement;
  title: string;
  additionalSubHeader: string;
  dayHeaderPrefix: string;
  date: string;
};

export function DefaultHeader(props: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState({});

  const auth = useAppSelector(state => state.auth);
  const user = useAppSelector(store => store.user.userSelfDetails);
  const route = useAppSelector(store => store.router);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  const { data: userList } = useFetchUserListQuery();

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

  const isScanView = () => {
    // @ts-ignore
    const path = route.location.pathname;
    return path === "/";
  };

  const { loading, numPhotosetItems, icon, numPhotos, title, additionalSubHeader, date, dayHeaderPrefix } = props;

  if (loading || numPhotosetItems < 1) {
    return (
      <div>
        <Title order={4}>
          <Group>
            {!loading &&
            auth.access &&
            isScanView() &&
            auth.access.is_admin &&
            !user.scan_directory &&
            numPhotosetItems < 1 ? (
              <div>
                <p>{t("defaultheader.setup")}</p>
                <Button
                  color="green"
                  onClick={() => {
                    setUserToEdit({ ...user });
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
                <Title style={{ minWidth: 200 }} align="left" order={2}>
                  {title} <ChevronDown size={20} />
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
}
