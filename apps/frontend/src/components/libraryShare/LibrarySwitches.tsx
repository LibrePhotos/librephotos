import type { LibraryShareSwitches } from "@librephotos/api-client";
import { Group, Stack, Switch, Text, ThemeIcon } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { LIBRARY_SWITCHES, type SwitchField } from "./libraryShareFields";

type Props = Readonly<{
  values: LibraryShareSwitches;
  onChange: (field: SwitchField, value: boolean) => void;
}>;

/**
 * The owner's five switches of a library share (#2731), each with what it shows. The originals
 * switch warns that an original file carries its GPS position whatever Location says.
 */
export function LibrarySwitches({ values, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <Stack gap="sm">
      {LIBRARY_SWITCHES.map(({ field, icon: Icon, label, description }) => (
        <Group key={field} justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="sm" wrap="nowrap" align="flex-start">
            <ThemeIcon variant="light" color="gray" size="md" aria-hidden>
              <Icon size={16} />
            </ThemeIcon>
            <div>
              <Text size="sm" fw={500}>
                {t(label)}
              </Text>
              <Text size="xs" c="dimmed">
                {t(description)}
              </Text>
              {field === "share_originals" && (
                <Group gap={4} wrap="nowrap" mt={2}>
                  <IconAlertTriangle size={14} color="var(--mantine-color-orange-6)" aria-hidden />
                  <Text size="xs" c="orange">
                    {t("librarySharing.originalsWarning")}
                  </Text>
                </Group>
              )}
            </div>
          </Group>
          <Switch
            aria-label={t(label)}
            checked={values[field]}
            onChange={event => onChange(field, event.currentTarget.checked)}
          />
        </Group>
      ))}
    </Stack>
  );
}

/** What every library share shares, and what none does. */
export function AlwaysAndNeverShared() {
  const { t } = useTranslation();
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        {t("librarySharing.alwaysShared")}
      </Text>
      <Text size="xs" c="dimmed">
        {t("librarySharing.neverShared")}
      </Text>
      <Text size="xs" c="dimmed">
        {t("librarySharing.searchRule")}
      </Text>
    </Stack>
  );
}
