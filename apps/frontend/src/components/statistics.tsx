import { Card, Grid, Group, HoverCard, Stack, Text, Title } from "@mantine/core";
import {
  IconCalendar as Calendar,
  IconFaceId as FaceId,
  IconPhoto as Photo,
  IconQuestionMark as QuestionMark,
  IconSettingsAutomation as SettingsAutomation,
  IconTag as Tag,
  IconUsers as Users,
} from "@tabler/icons-react";
import React from "react";
import { Trans, useTranslation } from "react-i18next";

import { COUNT_STATS_DEFAULTS, useFetchCountStatsQuery } from "../api_client/util";

export function CountStats() {
  const { t } = useTranslation();
  const { data: countStats = COUNT_STATS_DEFAULTS } = useFetchCountStatsQuery();

  return (
    <Grid gutter="xs">
      <Grid.Col span={{ base: 6, sm: 4, md: 2.4 }}>
        <Card withBorder p="xs">
          <Group justify="left" gap="xs">
            <Photo size={40} strokeWidth={1} />
            <div>
              <Text c="dimmed" size="xs">
                {t("countstats.photos")}
              </Text>
              <Title order={3} size="h4">
                {countStats.num_photos}
              </Title>
            </div>
          </Group>
        </Card>
      </Grid.Col>

      <Grid.Col span={{ base: 6, sm: 4, md: 2.4 }}>
        <Card withBorder p="xs">
          <Group justify="left" gap="xs">
            <Users size={40} strokeWidth={1} />
            <div>
              <Text c="dimmed" size="xs">
                {t("people")}
              </Text>
              <Title order={3} size="h4">
                {countStats.num_people}
              </Title>
            </div>
          </Group>
        </Card>
      </Grid.Col>

      <Grid.Col span={{ base: 6, sm: 4, md: 2.4 }}>
        <HoverCard width={200} shadow="md" withinPortal withArrow>
          <HoverCard.Target>
            <Card withBorder p="xs">
              <Group justify="left" gap="xs">
                <FaceId size={40} strokeWidth={1} />
                <div>
                  <Text c="dimmed" size="xs">
                    {t("faces")}
                  </Text>
                  <Title order={3} size="h4">
                    {countStats.num_faces}
                  </Title>
                </div>
              </Group>
            </Card>
          </HoverCard.Target>
          <HoverCard.Dropdown>
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="sm">
                  <Trans i18nKey="settings.inferred">Inferred</Trans>
                </Text>
                <Group gap="xs">
                  <FaceId size={16} />
                  <Text size="sm">{countStats.num_inferred_faces}</Text>
                </Group>
              </Group>
              <Group justify="space-between">
                <Text size="sm">
                  <Trans i18nKey="settings.labeled">Labeled</Trans>
                </Text>
                <Group gap="xs">
                  <Tag size={16} />
                  <Text size="sm">{countStats.num_labeled_faces}</Text>
                </Group>
              </Group>
              <Group justify="space-between">
                <Text size="sm">
                  <Trans i18nKey="settings.unknown">Unknown</Trans>
                </Text>
                <Group gap="xs">
                  <QuestionMark size={16} />
                  <Text size="sm">{countStats.num_unknown_faces}</Text>
                </Group>
              </Group>
            </Stack>
          </HoverCard.Dropdown>
        </HoverCard>
      </Grid.Col>

      <Grid.Col span={{ base: 6, sm: 4, md: 2.4 }}>
        <Card withBorder p="xs">
          <Group justify="left" gap="xs">
            <SettingsAutomation size={40} strokeWidth={1} />
            <div>
              <Text c="dimmed" size="xs">
                {t("events")}
              </Text>
              <Title order={3} size="h4">
                {countStats.num_albumauto}
              </Title>
            </div>
          </Group>
        </Card>
      </Grid.Col>

      <Grid.Col span={{ base: 6, sm: 4, md: 2.4 }}>
        <Card withBorder p="xs">
          <Group justify="left" gap="xs">
            <Calendar size={40} strokeWidth={1} />
            <div>
              <Text c="dimmed" size="xs">
                {t("days")}
              </Text>
              <Title order={3} size="h4">
                {countStats.num_albumdate}
              </Title>
            </div>
          </Group>
        </Card>
      </Grid.Col>
    </Grid>
  );
}
