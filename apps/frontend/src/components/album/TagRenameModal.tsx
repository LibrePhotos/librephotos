import { Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The tag being renamed; its name labels the input. */
  tagName: string | undefined;
  /** Every tag name, for the duplicate check. */
  existingNames: readonly string[];
  onSubmit: (newName: string) => void;
}>;

export function TagRenameModal({ opened, onClose, tagName, existingNames, onSubmit }: Props) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState("");
  // Every opening starts with an empty name
  useEffect(() => {
    if (opened) setNewName("");
  }, [opened]);
  const nameTaken = existingNames.some(name => name.toLowerCase().trim() === newName.toLowerCase().trim());

  return (
    <Modal size="sm" opened={opened} onClose={onClose} title={t("tagalbum.renametag")}>
      <Stack>
        <TextInput
          label={tagName}
          error={nameTaken ? t("tagalbum.tagalreadyexists", { name: newName.trim() }) : ""}
          value={newName}
          onChange={event => setNewName(event.currentTarget.value)}
          placeholder={t("tagalbum.tagplaceholder")}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            color="green"
            disabled={!newName.trim() || nameTaken}
            onClick={() => {
              onSubmit(newName.trim());
              onClose();
            }}
          >
            {t("rename")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
