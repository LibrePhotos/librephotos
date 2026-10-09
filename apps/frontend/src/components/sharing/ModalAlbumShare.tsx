import { Button, Divider, Group, Modal, Paper, ScrollArea, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import {
  IconChevronDown as ChevronDown,
  IconChevronUp as ChevronUp,
  IconSettings as SettingsIcon,
} from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchUserAlbumQuery, useToggleUserAlbumPublicMutation } from "../../api_client/albums/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { AlbumSlugSection } from "./AlbumSlugSection";
import { UserEntry } from "./UserEntry";
import filterUsers from "./utils";

type Props = Readonly<{
  isOpen: boolean;
  onRequestClose: () => void;
  albumID: string;
  ownerUsername?: string;
}>;

export function ModalAlbumShare(props: Props) {
  const [userNameFilter, setUserNameFilter] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();
  const { t } = useTranslation();
  const { isOpen, onRequestClose, albumID } = props;
  const { data: users, isFetching: isUsersFetching, isSuccess: isUsersLoaded } = useFetchUserListQuery();
  const toggleAlbumPublic = useToggleUserAlbumPublicMutation();
  const { data: album, refetch } = useFetchUserAlbumQuery(albumID ?? "");
  const isPublic = Boolean(album?.public);

  return (
    <Modal
      opened={isOpen}
      title={t("modalalbumsshare.title")}
      onClose={() => {
        onRequestClose();
        setUserNameFilter("");
      }}
    >
      <Stack>
        <Paper withBorder p="sm" radius="md">
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <div>
                <Title order={4}>{t("modalalbumsshare.publicsharing")}</Title>
                <Text size="xs" c="dimmed">
                  {t("modalalbumsshare.publicsharingdesc")}
                </Text>
              </div>
            </Group>
            <Group gap="xs" align="center">
              <Switch
                aria-label={t("modalalbumsshare.publicsharing")}
                checked={isPublic}
                onChange={e => {
                  toggleAlbumPublic.mutate(
                    { albumId: albumID, public: e.currentTarget.checked },
                    { onSuccess: () => refetch() }
                  );
                }}
              />
              <Text size="sm" c={isPublic ? "green" : "dimmed"} fw={500}>
                {isPublic ? t("settings.on") : t("settings.off")}
              </Text>
            </Group>
          </Group>

          {isPublic && (
            <Stack>
              <AlbumSlugSection
                albumID={albumID}
                album={album as any}
                isPublic={isPublic}
                showSettings={showSettings}
                refetch={refetch}
              />
              <Button
                size="xs"
                variant="light"
                leftSection={<SettingsIcon size={14} />}
                rightSection={showSettings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                onClick={() => setShowSettings(s => !s)}
              >
                {showSettings ? t("modalalbumsshare.hidesettings") : t("modalalbumsshare.showsettings")}
              </Button>
            </Stack>
          )}

          <Divider my="sm" />
          <Stack>
            <div>
              <Title order={4}>{t("modalalbumsshare.sharewithusers")}</Title>
              <Text size="xs" c="dimmed" mb={4}>
                {t("modalalbumsshare.sharewithusersdesc")}
              </Text>
            </div>
            <TextInput
              onChange={event => {
                setUserNameFilter(event.currentTarget.value);
              }}
              placeholder={t("modalalbumsshare.name")}
            />
            <Divider />

            {isUsersFetching && <div>{t("modalphotosshare.loading")}</div>}
            {isUsersLoaded && (
              <ScrollArea>
                <Stack>
                  {filterUsers(userNameFilter, currentUser?.id ?? 0, users).map(item => (
                    <UserEntry key={item.id} item={item} albumID={albumID} />
                  ))}
                </Stack>
              </ScrollArea>
            )}
          </Stack>
        </Paper>
        <Group justify="flex-end">
          <Button variant="default" onClick={onRequestClose}>
            {t("modalalbumsshare.done")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
