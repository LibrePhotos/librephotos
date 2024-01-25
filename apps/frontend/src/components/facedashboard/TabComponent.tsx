import { Group, Loader, Tabs } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

import { faceActions } from "../../store/faces/faceSlice";
import { FacesTab } from "../../store/faces/facesActions.types";
import type { IFacesTab } from "../../store/faces/facesActions.types";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { FacesCountersHoverCard } from "./FacesCountersHoverCard";

type Props = Readonly<{
  width: number;
  fetchingLabeledFacesList: boolean;
  fetchingInferredFacesList: boolean;
}>;

export function TabComponent({ width, fetchingLabeledFacesList, fetchingInferredFacesList }: Props) {
  const dispatch = useAppDispatch();
  const { activeTab } = useAppSelector(store => store.face);
  const changeTab = (tab: IFacesTab) => {
    dispatch(faceActions.changeTab(tab));
  };
  const { t } = useTranslation();

  return (
    <Group position="apart">
      <Tabs defaultValue={activeTab} style={{ width }} onTabChange={changeTab}>
        <Tabs.List>
          <FacesCountersHoverCard tab={FacesTab.enum.labeled}>
            <Tabs.Tab value={FacesTab.enum.labeled}>
              {t("settings.labeled")} {fetchingLabeledFacesList ? <Loader size="sm" /> : null}
            </Tabs.Tab>
          </FacesCountersHoverCard>
          <FacesCountersHoverCard tab={FacesTab.enum.inferred}>
            <Tabs.Tab value={FacesTab.enum.inferred}>
              {t("settings.inferred")} {fetchingInferredFacesList ? <Loader size="sm" /> : null}
            </Tabs.Tab>
          </FacesCountersHoverCard>
        </Tabs.List>
      </Tabs>
    </Group>
  );
}
