import { Button, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import React, { useEffect, useEffectEvent } from "react";
import { useTranslation } from "react-i18next";
import type { MergePerson } from "./PersonMergeModal";
import { makePersonMergeSchema } from "./PersonMergePickerModal.schema";

/** Options shown at once: a long people list is searched, not scrolled. */
const SHOWN_PEOPLE = 50;

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The person merged away; left out of the choices. */
  person: MergePerson;
  /** Every person, to choose the one to merge into. */
  people: readonly MergePerson[];
  /** The chosen person; the merge itself is confirmed next. */
  onPick: (target: MergePerson) => void;
}>;

/** The person page's "Merge into…": choose who this person really is. */
export function PersonMergePickerModal({ opened, onClose, person, people, onPick }: Props) {
  const { t } = useTranslation();
  const initialValues: { target: string | null } = { target: null };
  const form = useForm({
    initialValues,
    validate: schemaResolver(makePersonMergeSchema(t), { sync: true }),
  });
  // Every opening starts with no person chosen. `form` is a new object every render, not a trigger.
  const startOver = useEffectEvent(() => form.reset());
  useEffect(() => {
    if (opened) startOver();
  }, [opened]);
  const pick = form.onSubmit(({ target: targetId }) => {
    const target = people.find(other => other.id === targetId);
    if (target) onPick(target);
  });

  return (
    <Modal size="sm" opened={opened} onClose={onClose} title={t("personalbum.mergepickertitle", { name: person.name })}>
      {/* A form, so Enter in the search goes on too */}
      <form onSubmit={pick}>
        <Stack>
          <Text size="sm">{t("personalbum.mergepickerexplanation", { name: person.name })}</Text>
          <Select
            data-autofocus
            searchable
            aria-label={t("personalbum.mergepickerplaceholder")}
            placeholder={t("personalbum.mergepickerplaceholder")}
            nothingFoundMessage={t("personalbum.mergepickernothingfound")}
            limit={SHOWN_PEOPLE}
            data={people.filter(other => other.id !== person.id).map(other => ({ value: other.id, label: other.name }))}
            {...form.getInputProps("target")}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button disabled={!form.isValid()} type="submit">
              {t("continue")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
