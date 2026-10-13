import { Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconArrowMerge, IconEdit, IconFaceId, IconTrash } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDeletePersonAlbumMutation,
  useFetchPeopleAlbumsQuery,
  useRenamePersonAlbumMutation,
  type Person,
} from "../../api_client/albums/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { HeaderActionsMenu } from "../photolist/HeaderActionsMenu";
import { PersonDeleteModal } from "./PersonDeleteModal";
import { PersonMergeModal, type MergePerson } from "./PersonMergeModal";
import { PersonMergePickerModal } from "./PersonMergePickerModal";
import { PersonRenameModal } from "./PersonRenameModal";

type Props = Readonly<{ person: Person }>;

/**
 * The person page's "⋮": rename, merge into another person, manage faces, delete. A merge goes
 * on to the person merged into, a delete back to People.
 */
export function PersonHeaderMenu({ person }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [renameOpened, rename] = useDisclosure(false);
  const [pickOpened, pick] = useDisclosure(false);
  const [mergeOpened, merge] = useDisclosure(false);
  const [mergeTarget, setMergeTarget] = useState<MergePerson | null>(null);
  const [deleteOpened, remove] = useDisclosure(false);
  // Every person, for the rename's duplicate check and the merge choices. Loaded with the
  // page: the form reads its rules when the dialog opens.
  const { data: people } = useFetchPeopleAlbumsQuery();
  const renamePerson = useRenamePersonAlbumMutation();
  const deletePerson = useDeletePersonAlbumMutation();

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
