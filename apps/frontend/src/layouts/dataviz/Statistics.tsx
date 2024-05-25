import { Tabs } from "@mantine/core";
import {
  IconChartArea as ChartArea,
  IconCloud as Cloud,
  IconShare as Share,
  IconSitemap as Sitemap,
  IconUser as User,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

import { EventCountMonthGraph } from "../../components/charts/EventCountMonthGraph";
import FaceClusterScatter from "../../components/charts/FaceClusterGraph";
import { LocationDurationStackedBar } from "../../components/charts/LocationDurationStackedBar";
import { SocialGraph } from "../../components/charts/SocialGraph";
import { WordCloud } from "../../components/charts/WordCloud";
import { LocationLink } from "../../components/locationLink";
import { CountStats } from "../../components/statistics";

export function Statistics() {
  const { t } = useTranslation();

  return (
    <div style={{ padding: "10px 0" }}>
      <CountStats />

      <Tabs defaultValue="placetree">
        <Tabs.List position="apart">
          <Tabs.Tab value="placetree" leftSection={<Sitemap />}>
            {t("placetree")}
          </Tabs.Tab>
          <Tabs.Tab value="wordclouds" leftSection={<Cloud />}>
            {t("wordclouds")}
          </Tabs.Tab>
          <Tabs.Tab value="timeline" leftSection={<ChartArea />}>
            {t("timeline")}
          </Tabs.Tab>
          <Tabs.Tab value="socialgraph" leftSection={<Share />}>
            {t("socialgraph")}
          </Tabs.Tab>
          <Tabs.Tab value="facecluster" leftSection={<User />}>
            {t("facecluster")}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="placetree">
          <div>
            <LocationLink width={window.innerWidth - 120} height={window.innerHeight - 50} />
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="wordclouds">
          <div style={{ marginTop: "1rem" }}>
            <WordCloud height={320} type="location" />
          </div>
          <div style={{ marginTop: "1rem" }}>
            <WordCloud height={320} type="captions" />
          </div>
          <div style={{ marginTop: "1rem" }}>
            <WordCloud height={320} type="people" />
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="timeline">
          <div style={{ marginTop: "1rem" }}>
            <EventCountMonthGraph />
          </div>
          <div style={{ marginTop: "1rem" }}>
            <LocationDurationStackedBar />
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="socialgraph">
          <div style={{ marginTop: "1rem" }}>
            <SocialGraph height={window.innerHeight - 300} />
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="facecluster">
          <div style={{ marginTop: "1rem" }}>
            <FaceClusterScatter height={window.innerHeight - 320} />
          </div>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
