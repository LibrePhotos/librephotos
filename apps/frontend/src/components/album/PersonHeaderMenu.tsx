import type { PigPhoto } from "@librephotos/api-client";
import { Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconArrowMerge,
  IconCake,
  IconEdit,
  IconFaceId,
  IconPhoto,
  IconTrash,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDeletePersonAlbumMutation,
  useFetchPeopleAlbumsQuery,
  useRenamePersonAlbumMutation,
  useSetPersonAlbumCoverMutation,
  type Person,
} from "../../api_client/albums/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { AlbumCoverPickerModal } from "../modals/AlbumCoverPickerModal";
import { HeaderActionsMenu } from "../photolist/HeaderActionsMenu";
import { PersonDeleteModal } from "./PersonDeleteModal";
import { PersonGroupsModal } from "./PersonGroupsModal";
import { PersonMergeModal, type MergePerson } from "./PersonMergeModal";
import { PersonMergePickerModal } from "./PersonMergePickerModal";
import { PersonRenameModal } from "./PersonRenameModal";

type Props = Readonly<{
  person: Person;
  /** The person's photos, to pick the cover from. */
  photos: PigPhoto[];
  /** Opens the birth date dialog (#2750); focus goes back to `from`, the ⋮ button, when it closes. */
  onBirthDate: (from: HTMLElement | null) => void;
}>;

/**
 * The person page's "⋮": rename, the birth date, set the cover (any photo, no selection needed, #2240), groups,
 * merge into another person, manage faces, delete. A merge goes
 * on to the person merged into, a delete back to People.
 */
export function PersonHeaderMenu({ person, photos, onBirthDate }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [renameOpened, rename] = useDisclosure(false);
  const [groupsOpened, groups] = useDisclosure(false);
  const [coverOpened, cover] = useDisclosure(false);
  const [pickOpened, pick] = useDisclosure(false);
  const [mergeOpened, merge] = useDisclosure(false);
  const [mergeTarget, setMergeTarget] = useState<MergePerson | null>(null);
  const [deleteOpened, remove] = useDisclosure(false);
  // Every person, for the rename's duplicate check and the merge choices. Loaded with the
  // page: the form reads its rules when the dialog opens.
  const { data: people } = useFetchPeopleAlbumsQuery();
  const renamePerson = useRenamePersonAlbumMutation();
  const deletePerson = useDeletePersonAlbumMutation();
  const setCover = useSetPersonAlbumCoverMutation();

  const closeAndFocus = (close: () => void) => () => {
    close();
    trigger.current?.focus();
  };
  // This page's person is gone after a merge
  const showTarget = (id: string) => void navigate({ to: "/album/persons/$id", params: { id } });

  return (
    <>
      <HeaderActionsMenu label={t("personalbum.personactions")} triggerRef={trigger}>
        <Menu.Item leftSection={<IconEdit size={ICON_SIZE.menu} />} onClick={rename.open}>
          {t("rename")}
        </Menu.Item>
        <Menu.Item leftSection={<IconCake size={ICON_SIZE.menu} />} onClick={() => onBirthDate(trigger.current)}>
          {person.birth_date ? t("personbirthdate.menuedit") : t("personbirthdate.menuadd")}
        </Menu.Item>
        <Menu.Item leftSection={<IconPhoto size={ICON_SIZE.menu} />} onClick={cover.open}>
          {t("modalalbumcover.menuitem")}
        </Menu.Item>
        <Menu.Item leftSection={<IconUsersGroup size={ICON_SIZE.menu} />} onClick={groups.open}>
          {t("persongroups.menu")}
        </Menu.Item>
        <Menu.Item leftSection={<IconArrowMerge size={ICON_SIZE.menu} />} onClick={pick.open}>
          {t("personalbum.mergeintomenu")}
        </Menu.Item>
        <Menu.Item leftSection={<IconFaceId size={ICON_SIZE.menu} />} onClick={() => void navigate({ to: "/faces" })}>
          {t("personalbum.managefaces")}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<IconTrash size={ICON_SIZE.menu} />} onClick={remove.open}>
          {t("personalbum.deleteperson")}
        </Menu.Item>
      </HeaderActionsMenu>
      <PersonRenameModal
        opened={renameOpened}
        onClose={closeAndFocus(rename.close)}
        person={person}
        // The same duplicate check as the People page
        people={people ?? []}
        onSubmit={newPersonName => renamePerson.mutate({ id: person.id, personName: person.name, newPersonName })}
        onMerged={showTarget}
      />
      <PersonGroupsModal opened={groupsOpened} onClose={closeAndFocus(groups.close)} person={person} />
      <AlbumCoverPickerModal
        isOpen={coverOpened}
        onRequestClose={closeAndFocus(cover.close)}
        // Placeholders of days that have not loaded have no picture to pick
        photos={photos.filter(photo => !photo.isTemp)}
        albumTitle={person.name}
        onSelectCover={photo => setCover.mutate({ id: String(person.id), cover_photo: photo })}
      />
      <PersonMergePickerModal
        opened={pickOpened}
        onClose={closeAndFocus(pick.close)}
        person={person}
        people={people ?? []}
        onPick={target => {
          setMergeTarget(target);
          pick.close();
          merge.open();
        }}
      />
      {mergeTarget && (
        <PersonMergeModal
          opened={mergeOpened}
          onClose={closeAndFocus(merge.close)}
          source={person}
          target={mergeTarget}
          onMerged={showTarget}
        />
      )}
      <PersonDeleteModal
        opened={deleteOpened}
        onClose={closeAndFocus(remove.close)}
        person={person}
        onConfirm={() => deletePerson.mutate(person.id, { onSuccess: () => void navigate({ to: "/album/persons" }) })}
      />
    </>
  );
}
