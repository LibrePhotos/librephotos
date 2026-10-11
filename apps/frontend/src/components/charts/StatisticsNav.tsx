import { Tabs } from "@mantine/core";
import {
  IconChartBar,
  IconChartLine,
  IconCloud,
  IconMoodSmile,
  IconShare,
  IconVectorTriangle,
} from "@tabler/icons-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../PageHeader";

type StatisticsNavProps = {
  children: React.ReactNode;
};

const views = [
  { path: "/statistics/placetree", labelKey: "sidemenu.placetree", icon: IconVectorTriangle },
  { path: "/statistics/timeline", labelKey: "sidemenu.timeline", icon: IconChartBar },
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
      <PageHeader
        icon={IconChartLine}
        iconColor="var(--mantine-color-yellow-6)"
        title={t("statistics.title", "Statistics")}
        subtitle={t("countstats.explorecharts", "Explore charts")}
      />

      <div style={{ padding: 10 }}>
        <Tabs value={currentPath} onChange={value => value && navigate({ to: value })} color="yellow" variant="default">
          <Tabs.List mb="md">
            {views.map(view => (
              <Tabs.Tab
                key={view.path}
                value={view.path}
                leftSection={
                  <view.icon
                    size={18}
                    color={currentPath === view.path ? "var(--mantine-color-yellow-6)" : undefined}
                  />
                }
              >
                {t(view.labelKey)}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>

        {children}
      </div>
    </>
  );
}
