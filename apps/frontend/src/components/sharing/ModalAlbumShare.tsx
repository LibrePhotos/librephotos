import {
  Button,
  Divider,
  FocusTrap,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconChevronDown as ChevronDown,
  IconChevronUp as ChevronUp,
  IconSearch,
  IconSettings as SettingsIcon,
} from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchUserAlbumQuery, useToggleUserAlbumPublicMutation } from "../../api_client/albums/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { ConfirmModal } from "../modals/ConfirmModal";
import { DIALOG_SIZE } from "../modals/dialogSize";
import { AlbumSlugSection } from "./AlbumSlugSection";
import { MemberCeilingSection } from "./MemberCeilingSection";
import { MemberRoleConfirmModal } from "./MemberRoleConfirmModal";
import { memberRoleOf } from "./memberRoles";
import classes from "./ModalAlbumShare.module.css";
import { publicAlbumLink } from "./publicAlbum";
import { useMemberRoleChange } from "./useMemberRoleChange";
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
  const roleChange = useMemberRoleChange(albumID, album);

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
        size={DIALOG_SIZE.md}
        opened={isOpen}
        title={t("modalalbumsshare.title")}
        // Escape belongs to the confirmation while it is open; both would close otherwise.
        closeOnEscape={!turnOffOpened && !roleChange.opened}
        onClose={() => {
          onRequestClose();
          setUserNameFilter("");
        }}
      >
        {/* No focus ring at open: nothing is focused until Tab */}
        <FocusTrap.InitialFocus />
        {/* One surface: the public link, a hairline, then who it is shared with and what they see */}
        <Stack gap={0}>
          <section className={classes.section}>
            <div className={classes.sectionHead}>
              <div>
                <Title order={3} className={classes.sectionTitle}>
                  {t("modalalbumsshare.publicsharing")}
                </Title>
                <Text className={classes.sectionDesc}>{t("modalalbumsshare.publicsharingdesc")}</Text>
              </div>
              <Switch
                aria-label={t("modalalbumsshare.publicsharing")}
                checked={isPublic}
                onChange={e => (e.currentTarget.checked ? setPublic(true) : turnOffDialog.open())}
              />
            </div>

            {isPublic && (
              <Stack gap="sm" mt="sm">
                <AlbumSlugSection
                  albumID={albumID}
                  album={album}
                  isPublic={isPublic}
                  showSettings={showSettings}
                  refetch={refetch}
                />
                <Button
                  size="xs"
                  variant="subtle"
                  className={classes.settingsToggle}
                  leftSection={<SettingsIcon size={14} />}
                  rightSection={showSettings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  onClick={() => setShowSettings(s => !s)}
                >
                  {showSettings ? t("modalalbumsshare.hidesettings") : t("modalalbumsshare.showsettings")}
                </Button>
                <Text className={classes.note}>{t("collab.publicLinkOwnOnly")}</Text>
              </Stack>
            )}
          </section>

          <Divider my="lg" />

          <section className={classes.section}>
            <Title order={3} className={classes.sectionTitle}>
              {t("modalalbumsshare.sharewithusers")}
            </Title>
            <Text className={classes.sectionDesc}>{t("modalalbumsshare.sharewithusersdesc")}</Text>
            <Text className={classes.note} mt={6}>
              {t("sharing.whatRecipientsSee")}
            </Text>
            <TextInput
              mt="md"
              variant="filled"
              leftSection={<IconSearch size={16} />}
              onChange={event => {
                setUserNameFilter(event.currentTarget.value);
              }}
              placeholder={t("modalalbumsshare.name")}
              aria-label={t("modalalbumsshare.name")}
            />
            {isUsersFetching && (
              <Text className={classes.note} mt="sm">
                {t("modalphotosshare.loading")}
              </Text>
            )}
            {isUsersLoaded && (
              <ScrollArea.Autosize mah={280} mt="xs">
                <Stack gap={0}>
                  {filterUsers(userNameFilter, currentUser?.id ?? 0, users).map(item => (
                    <UserEntry
                      key={item.id}
                      item={item}
                      role={memberRoleOf(album, item)}
                      onChange={role => roleChange.request(item, role)}
                    />
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            )}
          </section>

          <section className={classes.section} data-spaced>
            <MemberCeilingSection albumID={albumID} album={album} />
          </section>

          <Group justify="flex-end" mt="xl">
            <Button onClick={onRequestClose}>{t("modalalbumsshare.done")}</Button>
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
      <MemberRoleConfirmModal roleChange={roleChange} albumTitle={album?.title ?? ""} />
    </>
  );
}
