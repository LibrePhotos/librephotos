import { Group, Loader, Tabs } from "@mantine/core";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { PAGE_GUTTER } from "../../uiConstants";
import { FacesCountersHoverCard } from "./FacesCountersHoverCard";
import { FacesTab } from "./facesTab";

type Props = Readonly<{
  fetchingLabeledFacesList: boolean;
  fetchingInferredFacesList: boolean;
}>;

const routeApi = getRouteApi("/_protected/faces");

export function TabComponent({ fetchingLabeledFacesList, fetchingInferredFacesList }: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const search = routeApi.useSearch();
  const { tab: activeTab } = search;

  return (
    <Group justify="space-between" px={PAGE_GUTTER}>
      <Tabs
        defaultValue={activeTab}
        value={activeTab}
        w="100%"
        onChange={value => {
          navigate({ to: "/faces", search: { ...search, tab: FacesTab.safeParse(value).data } });
        }}
      >
        <Tabs.List>
          <FacesCountersHoverCard tab={FacesTab.enum.inferred}>
            <Tabs.Tab value={FacesTab.enum.inferred}>
              {t("settings.inferred")} {fetchingInferredFacesList ? <Loader size="sm" /> : null}
            </Tabs.Tab>
          </FacesCountersHoverCard>
          <FacesCountersHoverCard tab={FacesTab.enum.unknown}>
            <Tabs.Tab value={FacesTab.enum.unknown}>{t("settings.unknown")}</Tabs.Tab>
          </FacesCountersHoverCard>
          <FacesCountersHoverCard tab={FacesTab.enum.labeled}>
            <Tabs.Tab value={FacesTab.enum.labeled}>
              {t("settings.labeled")} {fetchingLabeledFacesList ? <Loader size="sm" /> : null}
            </Tabs.Tab>
          </FacesCountersHoverCard>
        </Tabs.List>
      </Tabs>
    </Group>
  );
}
