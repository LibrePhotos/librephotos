import { Avatar, Grid, Group, Header, Menu } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import React, { useEffect } from "react";
import { Trans, useTranslation } from "react-i18next";
import { push } from "redux-first-history";
import { Adjustments, Book, Logout, Settings, User } from "tabler-icons-react";

import { toggleSidebar } from "../../actions/uiActions";
import { api } from "../../api_client/api";
import { serverAddress } from "../../api_client/apiClient";
import { logout } from "../../store/auth/authSlice";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { ChunkedUploadButton } from "../ChunkedUploadButton";
import { CustomSearch } from "../CustomSearch";
import { TopMenuCommon } from "./TopMenuPublic";
import { WorkerIndicator } from "./WorkerIndicator";

export function TopMenu() {
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const userSelfDetails = useAppSelector(state => state.user.userSelfDetails);
  const { t } = useTranslation();
  const matches = useMediaQuery("(min-width: 700px)");

  useEffect(() => {
    if (auth.access) {
      dispatch(api.endpoints.fetchUserSelfDetails.initiate(auth.access.user_id));
    }
  }, [auth.access, dispatch]);

  return (
    <Header height={45} px={10}>
      <Grid justify="space-between" grow style={{ paddingTop: 5 }}>
        {matches && <TopMenuCommon onToggleSidebar={() => dispatch(toggleSidebar())} />}
        <Grid.Col span={3}>
          <CustomSearch />
        </Grid.Col>
        <Grid.Col span={1}>
          <Group position="right" style={{ height: "100%" }}>
            <ChunkedUploadButton />
            <WorkerIndicator />

            <Menu width={200}>
              <Menu.Target>
                <Group spacing="xs" style={{ cursor: "pointer" }}>
                  <Avatar
                    src={
                      userSelfDetails && userSelfDetails.avatar_url
                        ? serverAddress + userSelfDetails.avatar_url
                        : "/unknown_user.jpg"
                    }
                    size={25}
                    alt="it's me"
                    radius="xl"
                  />
                </Group>
              </Menu.Target>

              <Menu.Dropdown>
                <Menu.Label>
                  <Trans i18nKey="topmenu.loggedin">Logged in as</Trans> {auth.access ? auth.access.name : ""}
                </Menu.Label>

                <Menu.Item icon={<Book />} onClick={() => dispatch(push("/library"))}>
                  {t("topmenu.library")}
                </Menu.Item>

                <Menu.Item icon={<User />} onClick={() => dispatch(push("/profile"))}>
                  {t("topmenu.profile")}
                </Menu.Item>

                <Menu.Item icon={<Settings />} onClick={() => dispatch(push("/settings"))}>
                  {t("topmenu.settings")}
                </Menu.Item>

                {auth.access && auth.access.is_admin && <Menu.Divider />}

                {auth.access && auth.access.is_admin && (
                  <Menu.Item icon={<Adjustments />} onClick={() => dispatch(push("/admin"))}>
                    {t("topmenu.adminarea")}
                  </Menu.Item>
                )}

                <Menu.Item
                  icon={<Logout />}
                  onClick={() => {
                    dispatch(logout());
                    dispatch(api.util.resetApiState());
                  }}
                >
                  {t("topmenu.logout")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Grid.Col>
      </Grid>
    </Header>
  );
}
