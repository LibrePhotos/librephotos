import { ActionIcon, Button, Group, Stack, Text, Tooltip } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconCalendar as Calendar, IconCheck as Check, IconEraser, IconX as X } from "@tabler/icons-react";
import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { photoTimestampWallClock, wallClockToPhotoTimestamp, type WallClock } from "../../util/dateUtils";
import { DisabledReason } from "../common/DisabledReason";
import { NativeDateInput, NativeTimeInput } from "../common/NativeDateInput";
import { makeTimestampFormSchema } from "./TimestampForm.schema";
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

const MIDNIGHT = "00:00:00";
const EMPTY: WallClock = { day: "", time: "" };

/** The date editor of the info panel: a day, a time, and Remove for a date set by hand. */
export function TimestampForm({ exifTimestamp, canRemove, saving, onSave, onRemove, onCancel }: Props) {
  const { t } = useTranslation();
  const removeHintId = useId();
  const [initial] = useState(() => (exifTimestamp ? photoTimestampWallClock(exifTimestamp) : null) ?? EMPTY);
  const initialTimestamp = wallClockToPhotoTimestamp(initial);
  const form = useForm<WallClock>({
    initialValues: initial,
    validate: schemaResolver(makeTimestampFormSchema(t), { sync: true }),
    validateInputOnChange: ["time"],
  });

  const onChangeDay = (picked: string) => {
    form.setFieldValue("day", picked);
    if (picked && form.getValues().time === "" && !form.isDirty("time")) form.setFieldValue("time", MIDNIGHT);
  };

  const save = form.onSubmit(values => {
    const value = wallClockToPhotoTimestamp(values);
    if (!value) return;
    if (value === initialTimestamp) {
      onCancel();
      return;
    }
    onSave(value);
  });
  const combined = wallClockToPhotoTimestamp(form.getValues());
  const dirty = combined === null ? form.isDirty() : combined !== initialTimestamp;
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
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <NativeDateInput
            label={t("changedatetime.day")}
            flex={3}
            {...form.getInputProps("day")}
            onChange={onChangeDay}
          />
          <NativeTimeInput withSeconds label={t("changedatetime.time")} flex={2} {...form.getInputProps("time")} />
        </Group>
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
