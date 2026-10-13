import { Avatar, Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Person } from "../../api_client/albums/hooks";
import { serverAddress } from "../../api_client/urls";
import { findByName } from "../../util/formSchemas";
import { PersonMergeModal, type MergePerson } from "./PersonMergeModal";
import { makePersonNameSchema } from "./personName.schema";
import classes from "./PersonRenameModal.module.css";

type FormProps = Readonly<{
  /** The person renamed: never offered as the one to merge into. */
  personId: string;
  /** Every person, for the duplicate check and the merge offer. */
  people: readonly MergePerson[];
  /** The current name, shown as the placeholder of the empty input. */
  placeholder: string;
  leftSection?: React.ReactNode;
  /** Gets the new name trimmed. */
  onSubmit: (newName: string) => void;
  /** The name is another person's: the same person, so they can be merged. */
  onMerge: (target: MergePerson) => void;
  onCancel: () => void;
}>;

/**
 * The rename form. It lives inside the modal body, which Mantine unmounts on close, so every
 * opening starts with an empty name.
 */
function PersonRenameForm({ personId, people, placeholder, leftSection, onSubmit, onMerge, onCancel }: FormProps) {
  const { t } = useTranslation();
  const form = useForm({
    initialValues: { name: "" },
    validate: schemaResolver(
      makePersonNameSchema(
        t,
        people.map(person => person.name)
      ),
      { sync: true }
    ),
    validateInputOnChange: ["name"],
    transformValues: ({ name }) => ({ name: name.trim() }),
  });
  // Two people with one name are one person (#864 was declined), so a taken name offers a merge
  const mergeTarget = findByName(
    people.filter(person => person.id !== personId),
    form.values.name
  );

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
          {mergeTarget ? (
            <Button
              className={classes.mergeButton}
              title={t("personalbum.mergeinto", { name: mergeTarget.name })}
              onClick={() => onMerge(mergeTarget)}
            >
              <span className={classes.mergeLabel}>{t("personalbum.mergeinto", { name: mergeTarget.name })}</span>
            </Button>
          ) : (
            // The backend refuses a blank name, and nothing would report that
            <Button disabled={!form.isValid()} type="submit">
              {t("rename")}
            </Button>
          )}
        </Group>
      </Stack>
    </form>
  );
}

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  person: Pick<Person, "id" | "name" | "face_url" | "face_count">;
  /** Every person, for the duplicate check and the merge offer. */
  people: readonly MergePerson[];
  onSubmit: (newName: string) => void;
  /** After a merge into another person: the person's own page moves on to them. */
  onMerged?: (targetId: string) => void;
}>;

/** Renaming a person, from the People page, the person page and the faces dashboard. */
export function PersonRenameModal({ opened, onClose, person, people, onSubmit, onMerged }: Props) {
  const { t } = useTranslation();
  const [mergeOpened, merge] = useDisclosure(false);
  const [mergeTarget, setMergeTarget] = useState<MergePerson | null>(null);

  return (
    <>
      <Modal
        title={t("personalbum.renamepersonheader", { name: person.name })}
        onClose={onClose}
        opened={opened}
        returnFocus={false}
      >
        <PersonRenameForm
          personId={person.id}
          people={people}
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
          onMerge={target => {
            // One dialog at a time: the confirmation replaces the rename
            setMergeTarget(target);
            onClose();
            merge.open();
          }}
          onCancel={onClose}
        />
      </Modal>
      {mergeTarget && (
        <PersonMergeModal
          opened={mergeOpened}
          onClose={merge.close}
          source={person}
          target={mergeTarget}
          onMerged={onMerged}
        />
      )}
    </>
  );
}
