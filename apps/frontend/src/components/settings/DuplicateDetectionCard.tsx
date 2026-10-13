import { User } from "@librephotos/api-client";
import { Card, Flex, Group, Radio, Switch, Title } from "@mantine/core";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import type { UserSettingsCardProps } from "./userSettingsCard";

const DuplicateSensitivity = User.shape.duplicate_sensitivity.unwrap();

export function DuplicateDetectionCard({ user, onChange }: UserSettingsCardProps) {
  const { t } = useTranslation();

  return (
    <Card shadow="md">
      <Title order={4} mb={16}>
        <Trans i18nKey="settings.duplicatedetection" />
      </Title>
      <Flex align="flex-start" direction="column" gap="md">
        <Radio.Group
          label={t("settings.duplicatesensitivity")}
          description={t("settings.duplicatesensitivityhelp")}
          value={user.duplicate_sensitivity || "normal"}
          onChange={value => {
            const sensitivity = DuplicateSensitivity.safeParse(value);
            onChange({ duplicate_sensitivity: sensitivity.success ? sensitivity.data : "normal" });
          }}
        >
          <Group mt="xs">
            <Radio value="strict" label={t("settings.sensitivity.strict")} />
            <Radio value="normal" label={t("settings.sensitivity.normal")} />
            <Radio value="loose" label={t("settings.sensitivity.loose")} />
          </Group>
        </Radio.Group>
        <Switch
          label={t("settings.duplicateclearexisting")}
          description={t("settings.duplicateclearexistinghelp")}
          checked={user.duplicate_clear_existing || false}
          onChange={event => onChange({ duplicate_clear_existing: event.currentTarget.checked })}
        />
      </Flex>
    </Card>
  );
}
