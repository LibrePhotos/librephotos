import { ActionIcon, Button, Card, Flex, Grid, Group, HoverCard, Stack, Text, Title } from "@mantine/core";
import React, { useEffect } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Calendar, FaceId, InfoCircle, Photo, QuestionMark, SettingsAutomation, Tag, Users } from "tabler-icons-react";

import { fetchCountStats } from "../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../store/store";

export const CountStats = () => {
  const util = useAppSelector(state => state.util);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  const { countStats } = useAppSelector(store => store.util);
  useEffect(() => {
    dispatch(fetchCountStats());
  }, []);

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
                  {util.countStats.num_inferred_faces}
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
                  {util.countStats.num_labeled_faces}
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
                  {util.countStats.num_unknown_faces}
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
};
