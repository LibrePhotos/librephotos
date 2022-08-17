import { Button, Grid, Group, Header, Image } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import React, { useEffect } from "react";
import { push } from "redux-first-history";
import { Menu2 } from "tabler-icons-react";

import { toggleSidebar } from "../../actions/uiActions";
import { api } from "../../api_client/api";
import { useAppDispatch, useAppSelector } from "../../store/store";

export function TopMenuPublic() {
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const matches = useMediaQuery("(min-width: 700px)");

  useEffect(() => {
    if (auth.access) {
      dispatch(api.endpoints.fetchUserSelfDetails.initiate(auth.access.user_id));
    }
  }, [auth.access, dispatch]);

  return (
    <Header height={45}>
      <Grid justify="space-between" grow style={{ padding: 5 }}>
        {matches && (
          <Grid.Col span={1}>
            <Group>
              <Menu2
                onClick={() => {
                  dispatch(toggleSidebar());
                }}
              />
              <Button
                color="dark"
                style={{
                  padding: 2,
                }}
              >
                <Image height={30} width={30} src="/logo-white.png" />
              </Button>
            </Group>
          </Grid.Col>
        )}
        <Grid.Col span={1}>
          <Group position="right">
            <Button
              onClick={() => {
                dispatch(push("/login"));
              }}
            >
              Login
            </Button>
          </Group>
        </Grid.Col>
      </Grid>
    </Header>
  );
}
