import { Avatar, Button, Group, Stack, Text, Title } from "@mantine/core";
import { IconUser as User } from "@tabler/icons-react";
import React, { useEffect } from "react";
import { push } from "redux-first-history";

import { fetchPublicUserList } from "../../actions/publicActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

export function PublicUserList() {
  const dispatch = useAppDispatch();
  const pub = useAppSelector(store => store.pub);

  useEffect(() => {
    dispatch(fetchPublicUserList());
  }, [dispatch]);

  return (
    <Stack align="flex-start">
      <Title order={2}>
        <div>
          <Group>
            <User />
            Users
          </Group>
          <Text color="dimmed">Showing {pub.publicUserList.length} users</Text>
        </div>
      </Title>
      {pub.publicUserList.map(el => {
        let displayName;
        if (el.first_name.length > 0 && el.last_name.length > 0) {
          displayName = `${el.first_name} ${el.last_name}`;
        } else {
          displayName = el.username;
        }

        return (
          <Button
            key={el.id}
            variant="subtle"
            style={{
              height: 42,
            }}
            onClick={() => {
              dispatch(push(`/user/${el.username}/`));
            }}
            leftIcon={<Avatar size={25} radius="xl" src="/unknown_user.jpg" />}
          >
            <div>
              <Text align="left">{displayName}</Text>
              <Text size="sm" color="dimmed">
                {el.public_photo_count} public photos
              </Text>
            </div>
          </Button>
        );
      })}
    </Stack>
  );
}
