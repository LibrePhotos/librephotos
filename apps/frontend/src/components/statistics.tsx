import { Button, Card, Group, Text, Title } from "@mantine/core";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, FaceId, Photo, SettingsAutomation, Users } from "tabler-icons-react";

import { fetchCountStats } from "../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../store/store";

export const CountStats = () => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  const { countStats } = useAppSelector(store => store.util);
  useEffect(() => {
    dispatch(fetchCountStats());
  }, []);

  return (
    <Group grow>
      <Card shadow="xs">
        <Title align="left">{countStats.num_photos}</Title>
        <Group position="left" spacing="xs">
          <Photo />
          <Text>{t("countstats.photos")}</Text>
        </Group>
      </Card>

      <Card shadow="xs">
        <Title align="left">{countStats.num_people}</Title>
        <Group position="left" spacing="xs">
          <Users />
          <Text> {t("people")}</Text>
        </Group>
      </Card>

      <Card shadow="xs">
        <Title align="left">{countStats.num_faces}</Title>
        <Group position="left" spacing="xs">
          <FaceId />
          <Text> {t("faces")}</Text>
        </Group>
      </Card>

      <Card shadow="xs">
        <Title align="left">{countStats.num_albumauto}</Title>
        <Group position="left" spacing="xs">
          <SettingsAutomation />
          <Text>{t("events")}</Text>
        </Group>
      </Card>

      <Card shadow="xs">
        <Title align="left">{countStats.num_albumdate}</Title>
        <Group position="left" spacing="xs">
          <Calendar />
          <Text>{t("days")}</Text>
        </Group>
      </Card>
    </Group>
  );
};
