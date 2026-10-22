import type { DatePhotosGroup } from "@librephotos/api-client";
import { Alert, Button, Group, Modal, Stack } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { schemaResolver, useForm } from "@mantine/form";
import { IconAlertTriangle, IconCake } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSetPersonBirthDateMutation, type Person } from "../../api_client/albums/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { calendarDaysAgo } from "../../util/dateUtils";
import { photosBefore } from "./personAge";
import { makePersonBirthDateSchema } from "./PersonBirthDateModal.schema";

type BirthPerson = Pick<Person, "id" | "name" | "birth_date">;

type FormProps = Readonly<{
  person: BirthPerson;
  groups: readonly DatePhotosGroup[];
  onClose: () => void;
}>;

/** The form inside the modal body, which Mantine unmounts on close: every opening starts from the saved date. */
function PersonBirthDateForm({ person, groups, onClose }: FormProps) {
  const { t } = useTranslation();
  const setBirthDate = useSetPersonBirthDateMutation();
  const today = calendarDaysAgo(0);
  const form = useForm({
    initialValues: { birthDate: person.birth_date },
    validate: schemaResolver(makePersonBirthDateSchema(t, today), { sync: true }),
    validateInputOnChange: ["birthDate"],
  });
  const save = (birthDate: string | null) =>
    setBirthDate.mutate({ id: person.id, name: person.name, birthDate }, { onSuccess: onClose });
  const { birthDate } = form.values;
  const older = birthDate && form.isValid() ? photosBefore(groups, birthDate) : 0;

  return (
    // A form, so Enter saves too
    <form onSubmit={form.onSubmit(values => save(values.birthDate))}>
      <Stack>
        <DateInput
          label={t("personbirthdate.label")}
          description={t("personbirthdate.description")}
          placeholder={t("personbirthdate.placeholder")}
          leftSection={<IconCake size={ICON_SIZE.inline} />}
          maxDate={today}
          clearable
          // A birthday decades back: start on the years, not on this month
          defaultLevel={birthDate ? "month" : "decade"}
          {...form.getInputProps("birthDate")}
        />
        {older > 0 && (
          <Alert color="yellow" icon={<IconAlertTriangle size={ICON_SIZE.inline} />}>
            {t("personbirthdate.photosbefore", { count: older, name: person.name })}
          </Alert>
        )}
        <Group justify="space-between">
          {person.birth_date ? (
            <Button variant="subtle" color="red" px={0} onClick={() => save(null)} loading={setBirthDate.isPending}>
              {t("personbirthdate.remove")}
            </Button>
          ) : (
            <span />
          )}
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" loading={setBirthDate.isPending}>
              {t("save")}
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  );
}

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  person: BirthPerson;
  /** The person page's date groups, to say how many photos are older than the date picked. */
  groups: readonly DatePhotosGroup[];
}>;

/** Set, change or remove a person's birth date (#2750), from the person page. Only the owner sees it. */
export function PersonBirthDateModal({ opened, onClose, person, groups }: Props) {
  const { t } = useTranslation();
  return (
    <Modal
      title={t("personbirthdate.title", { name: person.name })}
      opened={opened}
      onClose={onClose}
      // The opener moves the focus back itself: from the ⋮ menu, whose item is gone by then
      returnFocus={false}
    >
      <PersonBirthDateForm person={person} groups={groups} onClose={onClose} />
    </Modal>
  );
}
