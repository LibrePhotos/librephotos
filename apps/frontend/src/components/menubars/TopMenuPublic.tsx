import { Burger, Button, Group, Image } from "@mantine/core";
import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { push } from "redux-first-history";

import { api } from "../../api_client/api";
import { useAppDispatch, useAppSelector } from "../../store/store";

type Props = Readonly<{
  onToggleSidebar: () => void;
}>;

export function TopMenuCommon({ onToggleSidebar }: Props) {
  return (
    <Group visibleFrom="sm">
      <Burger size="sm" onClick={onToggleSidebar} />
      <Link to="/">
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
