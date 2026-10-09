import { Avatar, Loader, NavLink, Stack, Text } from "@mantine/core";
import { IconWorld } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { UserList } from "../../../api_client/user";
import { useFetchUserListQuery } from "../../../api_client/user/hooks";
import { avatarSrc } from "../../../components/sharing/avatarSrc";
import { SharingPageHeader } from "../../../components/sharing/SharingPageHeader";

export const Route = createFileRoute("/_protected/sharing/public")({
  component: PublicUserList,
});

function publicUsers(items: UserList = []) {
  return items.filter(el => el.public_sharing);
}

function PublicUserList() {
  const { t } = useTranslation();
  const { data: users, isLoading } = useFetchUserListQuery();
  const list = publicUsers(users);

  return (
    <Stack p="md" gap={0}>
      {/* Named like the section on the sharing overview that links here. */}
      <SharingPageHeader
        icon={IconWorld}
        title={t("sidemenu.publicphotos")}
        subtitle={isLoading ? undefined : t("sharing.userCount", { count: list.length })}
      />
      {isLoading && (
        <Stack align="center" mt="xl">
          <Loader />
        </Stack>
      )}
      {!isLoading && list.length === 0 && (
        <Stack align="center" mt="xl">
          <Text c="dimmed">{t("sharing.noPublicUsers")}</Text>
        </Stack>
      )}
      <Stack gap={4} maw={480}>
        {list.map(el => {
          let displayName: string;
          if (el.first_name.length > 0 && el.last_name.length > 0) {
            displayName = `${el.first_name} ${el.last_name}`;
          } else {
            displayName = el.username;
          }

          return (
            <NavLink
              key={el.id}
              renderRoot={rootProps => <Link {...rootProps} to="/public/$users" params={{ users: el.username }} />}
              label={displayName}
              description={t("sharing.publicPhotoCount", { count: el.public_photo_count })}
              leftSection={<Avatar size={40} radius="xl" src={avatarSrc(el)} />}
              styles={{ root: { borderRadius: "var(--mantine-radius-sm)" }, label: { fontWeight: 500 } }}
            />
          );
        })}
      </Stack>
    </Stack>
  );
}
