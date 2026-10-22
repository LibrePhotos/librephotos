import type { User } from "@librephotos/api-client";
import { Card, Stack, Text, Title } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { LibraryFolderList } from "./LibraryFolderList";

type Props = Readonly<{
  /** The signed-in user; without a scan directory there is no library to list. */
  user: Pick<User, "id" | "username" | "scan_directory">;
  isAdmin: boolean;
}>;

/** The Library page's folders (#123): what the scans read, above the Photos card. */
export function LibraryFoldersCard({ user, isAdmin }: Props) {
  const { t } = useTranslation();
  if (!user.scan_directory) {
    return null;
  }
  return (
    <Card shadow="md">
      <Stack gap="sm">
        <Stack gap={0}>
          <Title order={4}>{t("libraryfolders.title")}</Title>
          <Text size="sm" c="dimmed">
            {isAdmin ? t("libraryfolders.subtitle") : t("libraryfolders.subtitleuser")}
          </Text>
        </Stack>
        <LibraryFolderList owner="self" userId={user.id} username={user.username} canManage={isAdmin} />
      </Stack>
    </Card>
  );
}
