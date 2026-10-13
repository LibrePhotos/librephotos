import { Button, Divider, Group, Modal, Paper, ScrollArea, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
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
import { ConfirmModal } from "../modals/ConfirmModal";
import { AlbumSlugSection } from "./AlbumSlugSection";
import { publicAlbumLink } from "./publicAlbum";
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
  // Turning sharing off drops the slug for good (the backend never hands an old link out
  // again), so that direction asks first; turning it on saves at once.
  const [turnOffOpened, turnOffDialog] = useDisclosure(false);

  const setPublic = (makePublic: boolean, onSuccess?: () => void) =>
    toggleAlbumPublic.mutate(
      { albumId: albumID, public: makePublic },
      {
        onSuccess: () => {
          onSuccess?.();
          return refetch();
        },
      }
    );

  return (
    <>
      <Modal
        opened={isOpen}
        title={t("modalalbumsshare.title")}
        // Escape belongs to the confirmation while it is open; both would close otherwise.
        closeOnEscape={!turnOffOpened}
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
                  onChange={e => (e.currentTarget.checked ? setPublic(true) : turnOffDialog.open())}
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
                  album={album}
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
      <ConfirmModal
        opened={turnOffOpened}
        onClose={turnOffDialog.close}
        onConfirm={() => setPublic(false, turnOffDialog.close)}
        loading={toggleAlbumPublic.isPending}
        title={t("confirmdialog.publicoff.title")}
        message={
          album?.public_slug
            ? t("confirmdialog.publicoff.message", { url: publicAlbumLink(album.public_slug) })
            : t("confirmdialog.publicoff.messagenolink")
        }
        confirmLabel={t("confirmdialog.publicoff.confirm")}
        cancelLabel={t("confirmdialog.publicoff.cancel")}
      />
    </>
  );
}
