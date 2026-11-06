import { useLocation, useNavigate } from "@tanstack/react-router";
import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import { FeatureBoundary } from "../common/FeatureBoundary";
import { PageTabs } from "../common/PageTabs";
import { CountStats } from "../CountStats";
import { PageBody } from "../PageBody";
import { PageHeader } from "../PageHeader";

type StatisticsNavProps = {
  children: React.ReactNode;
};

type StatisticsView =
  | "/statistics/timeline"
  | "/statistics/placetree"
  | "/statistics/wordclouds"
  | "/statistics/socialgraph"
  | "/statistics/faceclusters";

// The timeline first: it is where /statistics opens, with charts that fill the page from the start
const views: ReadonlyArray<{ path: StatisticsView; labelKey: ParseKeys }> = [
  { path: "/statistics/timeline", labelKey: "sidemenu.timeline" },
  { path: "/statistics/placetree", labelKey: "sidemenu.placetree" },
  { path: "/statistics/wordclouds", labelKey: "sidemenu.wordclouds" },
  { path: "/statistics/socialgraph", labelKey: "sidemenu.socialgraph" },
  { path: "/statistics/faceclusters", labelKey: "sidemenu.facecluster" },
];

function isStatisticsView(path: string): path is StatisticsView {
  return views.some(view => view.path === path);
}

export function StatisticsNav({ children }: StatisticsNavProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;

  return (
    <>
      <PageHeader title={t("statistics.title")} subtitle={t("statistics.subtitle")} />

      {/* The page gutter like every other page; the counts first, then the charts */}
      <PageBody gap="lg">
        {/* The Library page's tiles, so the two pages count the same things the same way */}
        <CountStats />
        <PageTabs
          value={isStatisticsView(currentPath) ? currentPath : "/statistics/timeline"}
          onChange={path => void navigate({ to: path })}
          tabs={views.map(view => ({ value: view.path, label: t(view.labelKey) }))}
        />

        {/* A chart that fails keeps the tabs; switching tabs tries again. */}
        <FeatureBoundary name="statistics" resetKeys={[currentPath]}>
          {children}
        </FeatureBoundary>
      </PageBody>
    </>
  );
}
