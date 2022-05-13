import { Avatar, Button, Group, Stack, Text, Title } from "@mantine/core";
import { push } from "connected-react-router";
import React, { useEffect } from "react";
import { User } from "tabler-icons-react";

import { fetchPublicUserList } from "../../actions/publicActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

export const PublicUserList = () => {
  const dispatch = useAppDispatch();
  const pub = useAppSelector(store => store.pub);

  useEffect(() => {
    dispatch(fetchPublicUserList());
  }, []);

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
      {pub.publicUserList.map((el, idx) => {
        let displayName;
        if (el.first_name.length > 0 && el.last_name.length > 0) {
          displayName = `${el.first_name} ${el.last_name}`;
        } else {
          displayName = el.username;
        }

        return (
          <Button
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
};
