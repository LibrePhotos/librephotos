import { Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconEdit, IconFaceId, IconTrash } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useRef } from "react";
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
import { PersonRenameModal } from "./PersonRenameModal";

type Props = Readonly<{ person: Person }>;

/** The person page's "⋮": rename, manage faces, delete (which goes back to People). */
export function PersonHeaderMenu({ person }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [renameOpened, rename] = useDisclosure(false);
  const [deleteOpened, remove] = useDisclosure(false);
  // Every name, for the rename's duplicate check. Loaded with the page: the form reads its
  // rules when the dialog opens.
  const { data: people } = useFetchPeopleAlbumsQuery();
  const renamePerson = useRenamePersonAlbumMutation();
  const deletePerson = useDeletePersonAlbumMutation();

  const closeAndFocus = (close: () => void) => () => {
    close();
    trigger.current?.focus();
  };

  return (
    <>
      <HeaderActionsMenu label={t("personalbum.personactions")} triggerRef={trigger}>
        <Menu.Item leftSection={<IconEdit size={ICON_SIZE.menu} />} onClick={rename.open}>
          {t("rename")}
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
        existingNames={(people ?? []).map(other => other.name)}
        onSubmit={newPersonName => renamePerson.mutate({ id: person.id, personName: person.name, newPersonName })}
      />
      <PersonDeleteModal
        opened={deleteOpened}
        onClose={closeAndFocus(remove.close)}
        person={person}
        onConfirm={() => deletePerson.mutate(person.id, { onSuccess: () => void navigate({ to: "/album/persons" }) })}
      />
    </>
  );
}
