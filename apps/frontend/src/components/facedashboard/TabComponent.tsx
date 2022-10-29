import { Loader, Tabs } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useAppSelector, useAppDispatch } from "../../store/store";
import { faceActions } from "../../store/faces/faceSlice";
import { IFacesTab, FacesTab } from "../../store/faces/facesActions.types";

type Props = {
  width: number;
  fetchingLabeledFacesList: boolean;
  fetchingInferredFacesList: boolean;
};

export function TabComponent({ width, fetchingLabeledFacesList, fetchingInferredFacesList }: Props) {
  const dispatch = useAppDispatch();
  const { activeTab } = useAppSelector(store => store.face);
  const changeTab = (tab: IFacesTab) => {
    dispatch(faceActions.changeTab(tab));
  };
  const { t } = useTranslation();

  return (
    <Tabs defaultValue={activeTab} style={{ width }} onTabChange={changeTab}>
      <Tabs.List>
        <Tabs.Tab value={FacesTab.enum.labeled}>
          {t("settings.labeled")} {fetchingLabeledFacesList ? <Loader size="sm" /> : null}
        </Tabs.Tab>

        <Tabs.Tab value={FacesTab.enum.inferred}>
          {t("settings.inferred")} {fetchingInferredFacesList ? <Loader size="sm" /> : null}
        </Tabs.Tab>
      </Tabs.List>
    </Tabs>
  );
}
