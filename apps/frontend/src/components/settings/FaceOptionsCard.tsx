import { Card, Group, Radio, Stack, Switch, Title } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { SectionLink } from "./SettingsSection";
import { choiceOf, type UserSettingsCardProps } from "./userSettingsCard";

export function FaceOptionsCard({ user, onChange }: UserSettingsCardProps) {
  const { t } = useTranslation();
  // Face tags are written where the metadata sync writes, so not at all while it is Off (#2293).
  const metadataSyncOff = (user.save_metadata_to_disk ?? "OFF") === "OFF";

  return (
    <Card shadow="md">
      <Title order={4} mb={16}>
        {t("settings.face_options")}
        <SectionLink />
      </Title>
      <Stack gap="md">
        <Radio.Group
          label={t("settings.min_cluster_size")}
          description={t("settings.min_cluster_size_help")}
          value={choiceOf(user.min_cluster_size, "0")}
          onChange={value => onChange({ min_cluster_size: parseInt(value, 10) || 0 })}
        >
          <Group mt="xs">
            <Radio value="0" label={t("settings.size.auto")} />
            <Radio value="2" label={2} />
            <Radio value="4" label={4} />
            <Radio value="8" label={8} />
            <Radio value="16" label={16} />
          </Group>
        </Radio.Group>
        <Radio.Group
          label={t("settings.min_samples")}
          description={t("settings.min_samples_help")}
          value={choiceOf(user.min_samples, "1")}
          onChange={value => onChange({ min_samples: parseInt(value, 10) || 0 })}
        >
          <Group mt="xs">
            <Radio value="1" label={1} />
            <Radio value="2" label={2} />
            <Radio value="4" label={4} />
            <Radio value="8" label={8} />
            <Radio value="16" label={16} />
          </Group>
        </Radio.Group>
        <Radio.Group
          label={t("settings.cluster_selection_epsilon")}
          description={t("settings.cluster_selection_epsilon_help")}
          // Off is 0, a real choice here: not choiceOf, which reads 0 as unset.
          value={user.cluster_selection_epsilon.toString()}
          onChange={value => onChange({ cluster_selection_epsilon: parseFloat(value) || 0 })}
        >
          {/* Distances between unit-length face encodings, 0 to 2 (#1996); two faces of one person
              are about 0.9 apart. A backend migration moved saved values here from the old scale. */}
          <Group mt="xs">
            <Radio value="0" label={t("settings.size.off")} />
            <Radio value="0.9" label={t("settings.size.small")} />
            <Radio value="0.95" label={t("settings.size.normal")} />
            <Radio value="1" label={t("settings.size.high")} />
            <Radio value="1.05" label={t("settings.size.veryhigh")} />
          </Group>
        </Radio.Group>
        <Switch
          label={t("settings.save_face_tags_to_disk")}
          description={
            metadataSyncOff
              ? t("settings.save_face_tags_to_disk_needs_sync")
              : t("settings.save_face_tags_to_disk_help")
          }
          checked={user.save_face_tags_to_disk || false}
          disabled={metadataSyncOff}
          onChange={event => onChange({ save_face_tags_to_disk: event.currentTarget.checked })}
        />
      </Stack>
    </Card>
  );
}
