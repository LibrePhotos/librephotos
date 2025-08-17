import { Badge, Button, Divider, Group, Modal, Paper, ScrollArea, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
// If needed, we can replace this with @mantine/dates DateTimePicker later
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { useFetchUserListQuery } from "../../api_client/user/hooks";
import classes from "./ModalAlbumShare.module.css";
import { UserEntry } from "./UserEntry";
import filterUsers from "./utils";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useToggleUserAlbumPublicMutation } from "../../api_client/albums/hooks";
import { useFetchUserAlbumQuery } from "../../api_client/albums/hooks";
import { IconSettings as SettingsIcon, IconChevronDown as ChevronDown, IconChevronUp as ChevronUp } from "@tabler/icons-react";
import { AlbumSlugSection } from "./AlbumSlugSection";

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
      title={<span className={classes.title}>{t("modalphotosshare.title")}</span>}
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
              <Title order={4}>Public sharing</Title>
              <Text size="xs" c="dimmed">Anyone with this link can view the album.</Text>
              </div>
            </Group>
            <Group gap="xs" align="center">
              <Switch
                checked={isPublic}
                onChange={e => {
                  toggleAlbumPublic.mutate(
                    { albumId: albumID, public: e.currentTarget.checked },
                    { onSuccess: () => refetch() }
                  );
                }}
              />
              <Text size="sm" c={isPublic ? "green" : "dimmed"} fw={500}>
                {isPublic ? "On" : "Off"}
              </Text>
             
            </Group>
          </Group>

          {isPublic && (
            <Stack>
              <AlbumSlugSection albumID={albumID} album={album as any} isPublic={isPublic} showSettings={showSettings} refetch={refetch} />
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<SettingsIcon size={14} />}
                  rightSection={showSettings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  onClick={() => setShowSettings(s => !s)}
                >
                  {showSettings ? "Hide settings" : "Show settings"}
                </Button>
            </Stack>
          )}

          <Divider my="sm" />
          <Stack>
          <div>
          <Title order={4}>Share with LibrePhotos users</Title>
          <Text size="xs" c="dimmed" mb={4}>Invite specific users on this server to access the album.</Text>
          </div>
          <TextInput
            onChange={event => {
              setUserNameFilter(event.currentTarget.value);
            }}
            placeholder={t("modalphotosshare.name")}
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
          <Button variant="default" onClick={onRequestClose}>Done</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
