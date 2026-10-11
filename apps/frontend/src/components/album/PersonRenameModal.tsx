import { Avatar, Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Person } from "../../api_client/albums/hooks";
import { serverAddress } from "../../api_client/apiClient";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  person: Person;
  /** Every person name, for the duplicate check. */
  existingNames: readonly string[];
  onSubmit: (newName: string) => void;
}>;

export function PersonRenameModal({ opened, onClose, person, existingNames, onSubmit }: Props) {
  const { t } = useTranslation();
  const [newPersonName, setNewPersonName] = useState("");
  // Every opening starts with an empty name
  useEffect(() => {
    if (opened) setNewPersonName("");
  }, [opened]);
  const trimmedPersonName = newPersonName.trim();
  const personNameTaken = existingNames.some(name => name.toLowerCase().trim() === trimmedPersonName.toLowerCase());

  return (
    <Modal
      title={t("personalbum.renamepersonheader", { name: person.name })}
      onClose={onClose}
      opened={opened}
      returnFocus={false}
    >
      {/* A form, so Enter renames too */}
      <form
        onSubmit={e => {
          e.preventDefault();
          // The backend rejects a blank name, and nothing would report that
          if (!trimmedPersonName || personNameTaken) return;
          onClose();
          onSubmit(trimmedPersonName);
        }}
      >
        <Stack>
          <TextInput
            data-autofocus
            label={t("personalbum.nameplaceholder")}
            leftSection={
              <Avatar
                src={person.face_url ? `${serverAddress}${person.face_url}` : undefined}
                alt={person.name}
                radius="xl"
                size={24}
              />
            }
            error={personNameTaken ? t("personalbum.personalreadyexists", { name: trimmedPersonName }) : false}
            value={newPersonName}
            onChange={e => {
              setNewPersonName(e.currentTarget.value);
            }}
            placeholder={person.name}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button disabled={!trimmedPersonName || personNameTaken} type="submit">
              {t("rename")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
