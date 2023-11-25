import { Tabs } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { ChartArea, Cloud, Share, Sitemap, User } from "tabler-icons-react";

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
          <Tabs.Tab value="placetree" icon={<Sitemap />}>
            {t("placetree")}
          </Tabs.Tab>
          <Tabs.Tab value="wordclouds" icon={<Cloud />}>
            {t("wordclouds")}
          </Tabs.Tab>
          <Tabs.Tab value="timeline" icon={<ChartArea />}>
            {t("timeline")}
          </Tabs.Tab>
          <Tabs.Tab value="socialgraph" icon={<Share />}>
            {t("socialgraph")}
          </Tabs.Tab>
          <Tabs.Tab value="facecluster" icon={<User />}>
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
