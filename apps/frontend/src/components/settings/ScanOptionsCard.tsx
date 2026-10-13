import { Card, Flex, Group, Radio, Title } from "@mantine/core";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { SectionLink } from "./SettingsSection";
import type { UserSettingsCardProps } from "./userSettingsCard";

export function ScanOptionsCard({ user, onChange }: UserSettingsCardProps) {
  const { t } = useTranslation();

  return (
    <Card shadow="md">
      <Title order={4} mb={16}>
        <Trans i18nKey="settings.scanoptions" />
        <SectionLink />
      </Title>
      <Flex align="flex-start" direction="column" gap="md">
        <Radio.Group
          description={t("settings.sceneconfidencedescription")}
          label={t("settings.sceneconfidence")}
          value={user.confidence?.toString() || "0"}
          onChange={value => onChange({ confidence: parseFloat(value) || 0 })}
        >
          <Group mt="xs">
            <Radio value="0.5" label={t("settings.confidence.high")} />
            <Radio value="0.1" label={t("settings.confidence.standard")} />
            <Radio value="0.05" label={t("settings.confidence.low")} />
            <Radio value="0" label={t("settings.confidence.none")} />
          </Group>
        </Radio.Group>
        <Radio.Group
          label={t("settings.semanticsearchheader")}
          description={t("settings.semanticsearch.description")}
          value={user.semantic_search_topk?.toString()}
          onChange={value => onChange({ semantic_search_topk: parseInt(value, 10) || 0 })}
        >
          <Group mt="xs">
            <Radio value="100" label={t("settings.semanticsearch.top100")} />
            <Radio value="50" label={t("settings.semanticsearch.top50")} />
            <Radio value="10" label={t("settings.semanticsearch.top10")} />
            <Radio value="0" label={t("settings.semanticsearch.top0")} />
          </Group>
        </Radio.Group>
      </Flex>
    </Card>
  );
}
