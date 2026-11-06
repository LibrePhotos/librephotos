import { Loader, Tabs, Text } from "@mantine/core";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { countFaces, type FacesTabLists } from "./facesCounters";
import { FacesCountersHoverCard } from "./FacesCountersHoverCard";
import { FacesTab } from "./facesTab";
import classes from "./TabComponent.module.css";

type Props = Readonly<{
  fetchingLabeledFacesList: boolean;
  fetchingInferredFacesList: boolean;
  fetchingDeletedFacesList: boolean;
  /** The lists the page shows; the tabs count these, never a list of their own (#2236). */
  lists: FacesTabLists;
}>;

/**
 * A tab's face count, the faces its grid shows, dimmed after its name. Not on phones: with it the
 * four tabs no longer fit in one row there.
 */
function CountBadge({ count }: Readonly<{ count: number }>) {
  return (
    <Text span size="xs" className={classes.count} visibleFrom="xs">
      {count}
    </Text>
  );
}

const routeApi = getRouteApi("/_protected/faces");

export function TabComponent({
  fetchingLabeledFacesList,
  fetchingInferredFacesList,
  fetchingDeletedFacesList,
  lists,
}: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const search = routeApi.useSearch();
  const { tab: activeTab } = search;
  const counters = useMemo(() => countFaces(lists), [lists]);

  return (
    <Tabs
      defaultValue={activeTab}
      value={activeTab}
      variant="pills"
      classNames={{ tab: classes.tab, list: classes.list }}
      onChange={value => {
        navigate({ to: "/faces", search: { ...search, tab: FacesTab.safeParse(value).data } });
      }}
    >
      <Tabs.List>
        <FacesCountersHoverCard tab={FacesTab.enum.inferred} counters={counters}>
          <Tabs.Tab value={FacesTab.enum.inferred} rightSection={<CountBadge count={counters.inferred.faces} />}>
            {t("settings.inferred")} {fetchingInferredFacesList ? <Loader size="xs" /> : null}
          </Tabs.Tab>
        </FacesCountersHoverCard>
        <FacesCountersHoverCard tab={FacesTab.enum.unknown} counters={counters}>
          <Tabs.Tab value={FacesTab.enum.unknown} rightSection={<CountBadge count={counters.unknown.faces} />}>
            {t("settings.unknown")}
          </Tabs.Tab>
        </FacesCountersHoverCard>
        <FacesCountersHoverCard tab={FacesTab.enum.labeled} counters={counters}>
          <Tabs.Tab value={FacesTab.enum.labeled} rightSection={<CountBadge count={counters.labeled.faces} />}>
            {t("settings.labeled")} {fetchingLabeledFacesList ? <Loader size="xs" /> : null}
          </Tabs.Tab>
        </FacesCountersHoverCard>
        {/* Deleted faces, so a face deleted by mistake can be restored (#127) */}
        <FacesCountersHoverCard tab={FacesTab.enum.deleted} counters={counters}>
          <Tabs.Tab value={FacesTab.enum.deleted} rightSection={<CountBadge count={counters.deleted.faces} />}>
            {t("facesdashboard.deletedtab")} {fetchingDeletedFacesList ? <Loader size="xs" /> : null}
          </Tabs.Tab>
        </FacesCountersHoverCard>
      </Tabs.List>
    </Tabs>
  );
}
