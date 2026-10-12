import { Avatar, Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import React from "react";
import { useTranslation } from "react-i18next";
import type { Person } from "../../api_client/albums/hooks";
import { serverAddress } from "../../api_client/apiClient";
import { makePersonNameSchema } from "./personName.schema";

type FormProps = Readonly<{
  /** Every person name, for the duplicate check. */
  existingNames: readonly string[];
  /** The current name, shown as the placeholder of the empty input. */
  placeholder: string;
  leftSection?: React.ReactNode;
  /** Gets the new name trimmed. */
  onSubmit: (newName: string) => void;
  onCancel: () => void;
}>;

/**
 * The rename form of the people page and the faces dashboard. It lives inside the modal body,
 * which Mantine unmounts on close, so every opening starts with an empty name.
 */
export function PersonRenameForm({ existingNames, placeholder, leftSection, onSubmit, onCancel }: FormProps) {
  const { t } = useTranslation();
  const form = useForm({
    initialValues: { name: "" },
    validate: schemaResolver(makePersonNameSchema(t, existingNames), { sync: true }),
    validateInputOnChange: ["name"],
    transformValues: ({ name }) => ({ name: name.trim() }),
  });

  return (
    // A form, so Enter renames too
    <form onSubmit={form.onSubmit(({ name }) => onSubmit(name))}>
      <Stack>
        <TextInput
          data-autofocus
          label={t("personalbum.nameplaceholder")}
          leftSection={leftSection}
          placeholder={placeholder}
          {...form.getInputProps("name")}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            {t("cancel")}
          </Button>
          {/* The backend refuses a blank name, and nothing would report that */}
          <Button disabled={!form.isValid()} type="submit">
            {t("rename")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

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

  return (
    <Modal
      title={t("personalbum.renamepersonheader", { name: person.name })}
      onClose={onClose}
      opened={opened}
      returnFocus={false}
    >
      <PersonRenameForm
        existingNames={existingNames}
        placeholder={person.name}
        leftSection={
          <Avatar
            src={person.face_url ? `${serverAddress}${person.face_url}` : undefined}
            alt={person.name}
            radius="xl"
            size={24}
          />
        }
        onSubmit={newName => {
          onClose();
          onSubmit(newName);
        }}
        onCancel={onClose}
      />
    </Modal>
  );
}
