import { HoverCard, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import type { FacesCounters } from "./facesCounters";
import { FacesTab } from "./facesTab";

type Props = Readonly<{
  tab: FacesTab;
  /** Counted from the lists the page shows, so the card and the tab agree (#2236). */
  counters: FacesCounters;
  children: React.ReactNode;
}>;

function CountersText({ tab, counters }: Pick<Props, "tab" | "counters">) {
  const { t } = useTranslation();
  const faces = (count: number) => `(${t("facesdashboard.facescounter", { count })})`;

  switch (tab) {
    case FacesTab.enum.labeled:
      return (
        <Text size="sm">
          {t("facesdashboard.personscounter", { count: counters.labeled.groups })} {faces(counters.labeled.faces)}
        </Text>
      );
    case FacesTab.enum.inferred:
      return (
        <>
          <Text size="sm">
            {t("facesdashboard.assumedpersonscounter", { count: counters.inferred.groups })}{" "}
            {faces(counters.inferred.faces)}
          </Text>
          <Text size="sm">
            {t("facesdashboard.clusterscounter", { count: counters.clusters.groups })} {faces(counters.clusters.faces)}
          </Text>
        </>
      );
    case FacesTab.enum.unknown:
      return <Text size="sm">{t("facesdashboard.unknownfacescounter", { count: counters.unknown.faces })}</Text>;
  }
}

export function FacesCountersHoverCard({ tab, counters, children }: Props) {
  return (
    <HoverCard shadow="md" openDelay={500}>
      <HoverCard.Target>{children}</HoverCard.Target>
      <HoverCard.Dropdown>
        <Stack>
          <CountersText tab={tab} counters={counters} />
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}
