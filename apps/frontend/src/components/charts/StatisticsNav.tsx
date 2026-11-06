import { Tabs } from "@mantine/core";
import { IconChartBar, IconCloud, IconMoodSmile, IconShare, IconVectorTriangle } from "@tabler/icons-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import { FeatureBoundary } from "../common/FeatureBoundary";
import { PageBody } from "../PageBody";
import { PageHeader } from "../PageHeader";
import { StatisticsSummary } from "./StatisticsSummary";

type StatisticsNavProps = {
  children: React.ReactNode;
};

// The timeline first: it is where /statistics opens, with charts that fill the page from the start
const views: ReadonlyArray<{ path: string; labelKey: ParseKeys; icon: typeof IconChartBar }> = [
  { path: "/statistics/timeline", labelKey: "sidemenu.timeline", icon: IconChartBar },
  { path: "/statistics/placetree", labelKey: "sidemenu.placetree", icon: IconVectorTriangle },
  { path: "/statistics/wordclouds", labelKey: "sidemenu.wordclouds", icon: IconCloud },
  { path: "/statistics/socialgraph", labelKey: "sidemenu.socialgraph", icon: IconShare },
  { path: "/statistics/faceclusters", labelKey: "sidemenu.facecluster", icon: IconMoodSmile },
];

export function StatisticsNav({ children }: StatisticsNavProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;

  return (
    <>
      <PageHeader title={t("statistics.title")} subtitle={t("countstats.explorecharts")} />

      {/* The page gutter like every other page; the counts first, then the charts */}
      <PageBody gap="md">
        <StatisticsSummary />
        <Tabs value={currentPath} onChange={value => value && navigate({ to: value })} variant="default">
          <Tabs.List>
            {views.map(view => (
              <Tabs.Tab key={view.path} value={view.path} leftSection={<view.icon size={18} stroke={1.75} />}>
                {t(view.labelKey)}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>

        {/* A chart that fails keeps the tabs; switching tabs tries again. */}
        <FeatureBoundary name="statistics" resetKeys={[currentPath]}>
          {children}
        </FeatureBoundary>
      </PageBody>
    </>
  );
}
