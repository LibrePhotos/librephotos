import { Button, Group, Image } from "@mantine/core";
import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { push } from "redux-first-history";

import { api } from "../../api_client/api";
import { useAppDispatch, useAppSelector } from "../../store/store";

export function TopMenuCommon() {
  return (
    <Group visibleFrom="sm" style={{ width: "185px", flexShrink: 0 }}>
      <Link to="/" style={{ padding: 10 }}>
        <Button color="dark" style={{ padding: 2 }}>
          <Image height={30} width={30} src="/logo-white.png" />
        </Button>
      </Link>
    </Group>
  );
}

export function TopMenuPublic() {
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);

  useEffect(() => {
    if (auth.access) {
      dispatch(api.endpoints.fetchUserSelfDetails.initiate(auth.access.user_id));
    }
  }, [auth.access, dispatch]);

  return (
    <Group justify="space-between" px={15}>
      <Link to="/">
        <Image height={30} width={30} src="/logo-white.png" />
      </Link>
      <Group align="right">
        <Button onClick={() => dispatch(push("/login"))}>Login</Button>
      </Group>
    </Group>
  );
}
