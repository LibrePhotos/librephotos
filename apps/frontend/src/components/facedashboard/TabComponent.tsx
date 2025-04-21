import { Group, Loader, Tabs } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { FacesTab } from "../../api_client/faces/types";
import { FacesCountersHoverCard } from "./FacesCountersHoverCard";
import { getRouteApi, useNavigate } from "@tanstack/react-router";

type Props = Readonly<{
  width: number;
  fetchingLabeledFacesList: boolean;
  fetchingInferredFacesList: boolean;
}>;

const routeApi = getRouteApi("/_protected/faces");

export function TabComponent({ 
  width, 
  fetchingLabeledFacesList, 
  fetchingInferredFacesList,
}: Props) {

  
  const { tab: activeTab  } = routeApi.useSearch()

  const navigate = useNavigate();
  
  const { t } = useTranslation();

  return (
    <Group justify="apart">
      <Tabs defaultValue={activeTab} value={activeTab} style={{ width }} onChange={
        (value) => {
          navigate({
            to: "/faces",
            search: (prev) => ({
              ...prev,
              tab: value as FacesTab,
            })
          })
        }
      }>
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
