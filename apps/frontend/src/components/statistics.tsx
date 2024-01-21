import { Card, Flex, Grid, Group, HoverCard, Stack, Text, Title } from "@mantine/core";
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
    <Group grow spacing="xs" align="stretch">
      <Card withBorder p="xs">
        <Group position="left" spacing="xs">
          <Photo size={64} strokeWidth={1} />
          <div>
            <Text color="dimmed">{t("countstats.photos")}</Text>
            <Title order={3}>{countStats.num_photos}</Title>
          </div>
        </Group>
      </Card>

      <Card withBorder p="xs">
        <Group position="left" spacing="xs">
          <Users size={64} strokeWidth={1} />
          <div>
            <Text color="dimmed"> {t("people")}</Text>
            <Title order={3}>{countStats.num_people}</Title>
          </div>
        </Group>
      </Card>

      <Card withBorder p="xs">
        <HoverCard width={300} shadow="md" withinPortal withArrow>
          <HoverCard.Target>
            <Group position="left" spacing="xs">
              <FaceId size={64} strokeWidth={1} />
              <div>
                <Text color="dimmed">{t("faces")}</Text>
                <Title order={3}>{countStats.num_faces}</Title>
              </div>
            </Group>
          </HoverCard.Target>
          <HoverCard.Dropdown>
            <Grid>
              <Grid.Col span={9}>
                <Stack spacing={0}>
                  <Text>
                    <Trans i18nKey="settings.inferred">Inferred</Trans>
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={3}>
                <Flex gap="sm">
                  <FaceId />
                  {countStats.num_inferred_faces}
                </Flex>
              </Grid.Col>
              <Grid.Col span={9}>
                <Stack spacing={0}>
                  <Text>
                    <Trans i18nKey="settings.labeled">Labeled</Trans>
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={3}>
                <Flex gap="sm">
                  <Tag />
                  {countStats.num_labeled_faces}
                </Flex>
              </Grid.Col>
              <Grid.Col span={9}>
                <Stack spacing={0}>
                  <Text>
                    <Trans i18nKey="settings.unknown">Unknown</Trans>
                  </Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={3}>
                <Flex gap="sm">
                  <QuestionMark />
                  {countStats.num_unknown_faces}
                </Flex>
              </Grid.Col>
            </Grid>
          </HoverCard.Dropdown>
        </HoverCard>
      </Card>

      <Card withBorder p="xs">
        <Group position="left" spacing="xs">
          <SettingsAutomation size={64} strokeWidth={1} />
          <div>
            <Text color="dimmed">{t("events")}</Text>
            <Title order={3}>{countStats.num_albumauto}</Title>
          </div>
        </Group>
      </Card>

      <Card withBorder p="xs">
        <Group position="left" spacing="xs">
          <Calendar size={64} strokeWidth={1} />
          <div>
            <Text color="dimmed">{t("days")}</Text>
            <Title order={3}>{countStats.num_albumdate}</Title>
          </div>
        </Group>
      </Card>
    </Group>
  );
}
