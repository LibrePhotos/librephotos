import type { DateSummary } from "@librephotos/api-client";
import { Button, Group, Modal, SegmentedControl, Stack, Text } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useMediaQuery } from "@mantine/hooks";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDateSummaryQuery, useSetPhotosDateTimeMutation } from "../../api_client/photos/hooks";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import { photoTimestampToPickerDate } from "../../util/dateUtils";
import { DisabledReason } from "../common/DisabledReason";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { formatPickerTime } from "../lightbox/TimestampForm.schema";
import { WriteBackHint } from "../lightbox/WriteBackHint";
import { dateTimeChange, makeChangeDateTimeSchema, type ChangeDateTimeValues } from "./ChangeDateTimeModal.schema";
import { SetDateFields } from "./SetDateFields";
import { ShiftDateFields } from "./ShiftDateFields";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The selected photos, by hash or select-all. */
  selection: PhotoSelection;
  /** Called once the dates are saved, to end the selection. */
  onSaved: () => void;
}>;

type FormProps = Readonly<{
  summary: DateSummary;
  selection: PhotoSelection;
  onClose: () => void;
  onSaved: () => void;
}>;

/** Set starts on the oldest selected photo's day and time, or on today when none has a date. */
function initialValues(summary: DateSummary): ChangeDateTimeValues {
  const start = summary.oldest ? photoTimestampToPickerDate(summary.oldest.exif_timestamp) : null;
  const today = new Date();
  const day = start ?? new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return {
    // Without a dated photo there is nothing to shift.
    mode: summary.oldest ? "shift" : "set",
    direction: "earlier",
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    day,
    time: formatPickerTime(day),
  };
}

function ChangeDateTimeForm({ summary, selection, onClose, onSaved }: FormProps) {
  const { t } = useTranslation();
  const [initial] = useState<ChangeDateTimeValues>(() => initialValues(summary));
  const form = useForm({
    initialValues: initial,
    validate: schemaResolver(makeChangeDateTimeSchema(t), { sync: true }),
    validateInputOnChange: ["time"],
  });
  const setDateTime = useSetPhotosDateTimeMutation();
  const values = form.getValues();
  const dated = summary.count - summary.without_date;
  const count = values.mode === "shift" ? dated : summary.count;
  const reason =
    !form.isValid() && (values.mode === "shift" ? t("changedatetime.entershift") : t("changedatetime.pickdatetime"));

  const save = form.onSubmit(submitted => {
    const change = dateTimeChange(submitted);
    if (!change) return;
    setDateTime.mutate(
      { selection, change },
      {
        onSuccess: () => {
          onClose();
          onSaved();
        },
      }
    );
  });

  return (
    <form onSubmit={save}>
      <Stack gap="md">
        <SegmentedControl
          fullWidth
          data={[
            { value: "shift", label: t("changedatetime.shift"), disabled: dated === 0 },
            { value: "set", label: t("changedatetime.set") },
          ]}
          value={values.mode}
          onChange={mode => form.setFieldValue("mode", mode === "set" ? "set" : "shift")}
        />
        {dated === 0 && (
          <Text size="sm" c="dimmed">
            {t("changedatetime.nothingtoshift")}
          </Text>
        )}
        {values.mode === "shift" ? (
          <ShiftDateFields form={form} summary={summary} />
        ) : (
          <SetDateFields form={form} count={summary.count} />
        )}
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            {t("changedatetime.usersethint")}
          </Text>
          <WriteBackHint field="date" />
        </Stack>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("changedatetime.cancel")}
          </Button>
          <DisabledReason reason={reason}>
            <Button type="submit" loading={setDateTime.isPending}>
              {values.mode === "shift"
                ? t("changedatetime.shiftbutton", { count })
                : t("changedatetime.setbutton", { count })}
            </Button>
          </DisabledReason>
        </Group>
      </Stack>
    </form>
  );
}

/**
 * "Change date and time…" of the selection (#2278): shift every selected photo by one amount, or
 * give them all one date and time. The dates of the selection come from the server, so a
 * select-all previews its real oldest and newest photo.
 */
export function ChangeDateTimeModal({ opened, onClose, selection, onSaved }: Props) {
  const { t } = useTranslation();
  const summaryQuery = useDateSummaryQuery(selection, opened);
  const failure = useListFailure(summaryQuery);
  const summary = summaryQuery.data;
  const isPhone = useMediaQuery("(max-width: 36em)") ?? false;
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size={480}
      // A phone gets the whole screen: the four number fields and the calendar need it.
      fullScreen={isPhone}
      title={summary ? t("changedatetime.title", { count: summary.count }) : t("changedatetime.titleloading")}
    >
      {summary && <ChangeDateTimeForm summary={summary} selection={selection} onClose={onClose} onSaved={onSaved} />}
      {!summary && failure && <ErrorState failure={failure} compact />}
      {!summary && !failure && <PageLoader label={t("changedatetime.loading")} />}
    </Modal>
  );
}
