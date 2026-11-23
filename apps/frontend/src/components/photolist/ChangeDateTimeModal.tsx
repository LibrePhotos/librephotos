import type { DateSummary } from "@librephotos/api-client";
import { Button, FocusTrap, Group, Modal, SegmentedControl, Stack, Text } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useMediaQuery } from "@mantine/hooks";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDateSummaryQuery, useSetPhotosDateTimeMutation } from "../../api_client/photos/hooks";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { calendarDaysAgo, photoTimestampWallClock } from "../../util/dateUtils";
import { DisabledReason } from "../common/DisabledReason";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { WriteBackHint } from "../lightbox/WriteBackHint";
import { DIALOG_SIZE } from "../modals/dialogSize";
import { dateTimeChange, makeChangeDateTimeSchema, type ChangeDateTimeValues } from "./ChangeDateTimeModal.schema";
import { ConvertTimeZoneFields } from "./ConvertTimeZoneFields";
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
  defaultTimezone: string;
  selection: PhotoSelection;
  onClose: () => void;
  onSaved: () => void;
}>;

/** Set starts on the oldest selected photo's day and time, or on today when none has a date. */
function initialValues(summary: DateSummary, defaultTimezone: string): ChangeDateTimeValues {
  const start = summary.oldest ? photoTimestampWallClock(summary.oldest.exif_timestamp) : null;
  const { day, time } = start ?? { day: calendarDaysAgo(0), time: "00:00:00" };
  return {
    // Without a dated photo there is nothing to shift.
    mode: summary.oldest ? "shift" : "set",
    direction: "earlier",
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    day,
    time,
    fromTimezone: defaultTimezone,
    toTimezone: "",
  };
}

function ChangeDateTimeForm({ summary, defaultTimezone, selection, onClose, onSaved }: FormProps) {
  const { t } = useTranslation();
  const [initial] = useState<ChangeDateTimeValues>(() => initialValues(summary, defaultTimezone));
  const form = useForm({
    initialValues: initial,
    validate: schemaResolver(makeChangeDateTimeSchema(t), { sync: true }),
    validateInputOnChange: ["time"],
  });
  const setDateTime = useSetPhotosDateTimeMutation();
  const values = form.getValues();
  const dated = summary.count - summary.without_date;
  const count = values.mode === "set" ? summary.count : dated;
  const reason =
    !form.isValid() &&
    (values.mode === "shift"
      ? t("changedatetime.entershift")
      : values.mode === "convert_timezone"
        ? t("changedatetime.pickzones")
        : t("changedatetime.pickdatetime"));

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
            { value: "convert_timezone", label: t("changedatetime.convert"), disabled: dated === 0 },
          ]}
          value={values.mode}
          onChange={mode => {
            if (mode === "shift" || mode === "set" || mode === "convert_timezone") {
              form.setFieldValue("mode", mode);
            }
          }}
        />
        {dated === 0 && (
          <Text size="sm" c="dimmed">
            {t("changedatetime.nothingtoshift")}
          </Text>
        )}
        {values.mode === "shift" && <ShiftDateFields form={form} summary={summary} />}
        {values.mode === "set" && <SetDateFields form={form} count={summary.count} />}
        {values.mode === "convert_timezone" && <ConvertTimeZoneFields form={form} summary={summary} />}
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            {t("changedatetime.usersethint")}
          </Text>
          <WriteBackHint field="date" />
        </Stack>
        <Group justify="flex-end">
          <Button variant="light" onClick={onClose}>
            {t("changedatetime.cancel")}
          </Button>
          <DisabledReason reason={reason}>
            <Button type="submit" loading={setDateTime.isPending}>
              {values.mode === "shift" && t("changedatetime.shiftbutton", { count })}
              {values.mode === "set" && t("changedatetime.setbutton", { count })}
              {values.mode === "convert_timezone" && t("changedatetime.convertbutton", { count })}
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
  const userQuery = useCurrentUserSelfDetailsQuery();
  const failure = useListFailure(summaryQuery);
  const summary = userQuery.isLoading ? undefined : summaryQuery.data;
  const isPhone = useMediaQuery("(max-width: 36em)") ?? false;
  return (
    <Modal
      size={DIALOG_SIZE.md}
      opened={opened}
      onClose={onClose}
      // A phone gets the whole screen: the four number fields and the calendar need it.
      fullScreen={isPhone}
      title={summary ? t("changedatetime.title", { count: summary.count }) : t("changedatetime.titleloading")}
    >
      {/* No focus ring at open: nothing is focused until Tab */}
      <FocusTrap.InitialFocus />
      {summary && (
        <ChangeDateTimeForm
          summary={summary}
          defaultTimezone={userQuery.data?.default_timezone ?? ""}
          selection={selection}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
      {!summary && failure && <ErrorState failure={failure} compact />}
      {!summary && !failure && <PageLoader label={t("changedatetime.loading")} />}
    </Modal>
  );
}
