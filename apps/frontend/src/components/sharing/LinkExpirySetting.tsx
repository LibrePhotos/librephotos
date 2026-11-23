import { Button, Group, Stack } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { dateTimeInputDaysFromNow, fromDateTimeInputValue, toDateTimeInputValue } from "../../util/dateUtils";
import { NativeDateTimeInput } from "../common/NativeDateInput";

const EXPIRY_PRESETS = [
  { days: 7, label: "sharing.days7" },
  { days: 30, label: "sharing.days30" },
  { days: 90, label: "sharing.days90" },
] as const;

type Props = Readonly<{
  value: string;
  onChange: (v: string) => void;
}>;

export function LinkExpirySetting({ value, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <Stack gap="xs">
      <NativeDateTimeInput
        label={t("sharing.expiration")}
        clearable
        value={toDateTimeInputValue(value)}
        onChange={picked => onChange(fromDateTimeInputValue(picked) ?? "")}
      />
      <Group gap="xs">
        {EXPIRY_PRESETS.map(({ days, label }) => (
          <Button
            key={days}
            size="xs"
            variant="light"
            onClick={() => onChange(fromDateTimeInputValue(dateTimeInputDaysFromNow(days)) ?? "")}
          >
            {t(label)}
          </Button>
        ))}
        <Button size="xs" variant="subtle" onClick={() => onChange("")}>
          {t("sharing.never")}
        </Button>
      </Group>
    </Stack>
  );
}
