import { Avatar, Button, Group, Stack, Text, Title } from "@mantine/core";
import { IconUser as User } from "@tabler/icons-react";
import React from "react";
import { useNavigate } from "react-router-dom";

import { useFetchUserListQuery } from "../../api_client/api";
import { UserList } from "../../store/user/user.zod";

function publicUsers(items: UserList = []) {
  return items.filter(el => el.public_sharing);
}

export function PublicUserList() {
  const navigate = useNavigate();
  const { data: users } = useFetchUserListQuery();

  return (
    <Stack align="flex-start">
      <Title order={2}>
        <div>
          <Group>
            <User />
            Users
          </Group>
          <Text color="dimmed">Showing {publicUsers(users).length} users</Text>
        </div>
      </Title>
      {publicUsers(users).map(el => {
        let displayName: string;
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
            onClick={() => navigate(`/user/${el.username}/`)}
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
