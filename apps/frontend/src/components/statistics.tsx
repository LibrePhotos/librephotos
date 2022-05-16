import { Button, Group, Title } from "@mantine/core";
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
    <Group position="apart">
      <div>
        <Title align="center">{countStats.num_photos}</Title>
        <Group position="center">
          <Button variant="subtle" color="dark" leftIcon={<Photo size={20} />}>
            {t("countstats.photos")}
          </Button>
        </Group>
      </div>

      <div>
        <Title align="center">{countStats.num_people}</Title>
        <Group position="center">
          <Button variant="subtle" color="dark" leftIcon={<Users size={20} />}>
            {t("people")}
          </Button>
        </Group>
      </div>

      <div>
        <Title align="center">{countStats.num_faces}</Title>
        <Group position="center">
          <Button variant="subtle" color="dark" leftIcon={<FaceId size={20} />}>
            {t("faces")}
          </Button>
        </Group>
      </div>

      <div>
        <Title align="center">{countStats.num_albumauto}</Title>
        <Group position="center">
          <Button variant="subtle" color="dark" leftIcon={<SettingsAutomation size={20} />}>
            {t("events")}
          </Button>
        </Group>
      </div>

      <div>
        <Title align="center">{countStats.num_albumdate}</Title>
        <Group position="center">
          <Button variant="subtle" color="dark" leftIcon={<Calendar size={20} />}>
            {t("days")}
          </Button>
        </Group>
      </div>
    </Group>
  );
};
