import { ActionIcon, Button, Group, Stack, Text, Tooltip } from "@mantine/core";
import { DatePicker, TimeInput } from "@mantine/dates";
import { schemaResolver, useForm } from "@mantine/form";
import { IconCalendar as Calendar, IconCheck as Check, IconEraser, IconX as X } from "@tabler/icons-react";
import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { parsePickerDate, photoTimestampToPickerDate, pickerDateToPhotoTimestamp } from "../../util/dateUtils";
import { DisabledReason } from "../common/DisabledReason";
import { combineDayAndTime, formatPickerTime, makeTimestampFormSchema } from "./TimestampForm.schema";
import { UnsavedBadge } from "./UnsavedBadge";
import { useRegisterDraft } from "./unsavedDrafts";
import { WriteBackHint } from "./WriteBackHint";

type Props = Readonly<{
  /** The photo's date when the editor opened. */
  exifTimestamp: string | null;
  /** The date was set by hand, so there is one to remove. */
  canRemove: boolean;
  saving: boolean;
  onSave: (exifTimestamp: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}>;

type Values = { day: Date | null; time: string };

const MIDNIGHT = "00:00:00";

/** The date editor of the info panel: a day, a time, and Remove for a date set by hand. */
export function TimestampForm({ exifTimestamp, canRemove, saving, onSave, onRemove, onCancel }: Props) {
  const { t } = useTranslation();
  const removeHintId = useId();
  const [initial] = useState(() => (exifTimestamp ? photoTimestampToPickerDate(exifTimestamp) : null));
  // Day and time are separate fields, so a time typed before a day is picked stays.
  const form = useForm<Values>({
    initialValues: { day: initial, time: formatPickerTime(initial) },
    validate: schemaResolver(makeTimestampFormSchema(t), { sync: true }),
    validateInputOnChange: ["time"],
  });

  const onChangeDay = (picked: Date | string | null) => {
    form.setFieldValue("day", picked ? parsePickerDate(picked) : null);
    // A day picked for a photo without a time starts at midnight, shown in the field. A time the
    // user emptied or half typed stays as it is, and keeps Save off.
    if (picked && form.getValues().time === "" && !form.isDirty("time")) form.setFieldValue("time", MIDNIGHT);
  };

  const save = form.onSubmit(values => {
    const value = combineDayAndTime(values);
    if (!value) return;
    // Save sits where the pencil was, so a double-click saves straight away. An
    // unchanged date is a Cancel, not a metadata write and an edit-history entry.
    if (value.getTime() === initial?.getTime()) {
      onCancel();
      return;
    }
    const exifValue = pickerDateToPhotoTimestamp(value);
    if (exifValue) onSave(exifValue);
  });
  const { day } = form.getValues();
  // As Save sees it: the same day and time picked again is no change, a half-typed time is one.
  const combined = combineDayAndTime(form.getValues());
  const dirty = combined === null ? form.isDirty() : combined.getTime() !== initial?.getTime();
  useRegisterDraft("date", dirty);

  return (
    <Stack w="100%">
      {/* Cancel and save sit where the caption, tags and keywords put them. */}
      <Group justify="space-between" wrap="nowrap">
        <Group wrap="nowrap">
          <Calendar />
          <Text>{t("lightbox.sidebar.editdatetime")}</Text>
          {dirty && <UnsavedBadge />}
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Tooltip label={t("lightbox.sidebar.cancel")}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={t("lightbox.sidebar.cancel")}
              onClick={onCancel}
            >
              <X size={16} />
            </ActionIcon>
          </Tooltip>
          <DisabledReason
            label={t("lightbox.sidebar.save")}
            reason={!form.isValid() && t("lightbox.sidebar.invalidtimestamp")}
          >
            <ActionIcon
              variant="subtle"
              color="blue"
              size="sm"
              aria-label={t("lightbox.sidebar.save")}
              loading={saving}
              onClick={() => save()}
            >
              <Check size={16} />
            </ActionIcon>
          </DisabledReason>
        </Group>
      </Group>
      <Stack>
        {/* The month shown comes only from defaultDate, never from value. */}
        <DatePicker value={day} defaultDate={day ?? undefined} onChange={onChangeDay} />
        <TimeInput withSeconds placeholder={MIDNIGHT} {...form.getInputProps("time")} />
        <WriteBackHint field="date" />
        {canRemove && (
          <Stack gap={4} align="flex-start">
            <Button
              variant="subtle"
              color="red"
              size="compact-sm"
              leftSection={<IconEraser size={16} />}
              disabled={saving}
              aria-describedby={removeHintId}
              onClick={onRemove}
            >
              {t("lightbox.sidebar.removetimestamp")}
            </Button>
            <Text id={removeHintId} size="xs" c="dimmed">
              {t("lightbox.sidebar.removetimestamphint")}
            </Text>
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
