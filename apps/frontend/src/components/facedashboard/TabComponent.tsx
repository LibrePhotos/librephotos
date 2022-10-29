import { Loader, Tabs } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useAppSelector, useAppDispatch } from "../../store/store";
import { faceActions } from "../../store/faces/faceSlice";

type Props = {
  width: number;
  fetchingLabeledFacesList: boolean;
  fetchingInferredFacesList: boolean;
};

export function TabComponent({ width, fetchingLabeledFacesList, fetchingInferredFacesList }: Props) {
  const dispatch = useAppDispatch();
  const { activeTab } = useAppSelector(store => store.face);
  const setActiveTab = (tabNumber: number) => {
    if (tabNumber === 0)
      dispatch(faceActions.changeTab("labeled"));
    else if (tabNumber === 1)
      dispatch(faceActions.changeTab("inferred"));
  };
  const { t } = useTranslation();

  return (
    <Tabs style={{ width: width }} active={activeTab} onTabChange={setActiveTab}>
      <Tabs.Tab
        name="labeled"
        value="labeled"
        label={
          <div>
            {t("settings.labeled")} {fetchingLabeledFacesList ? <Loader size="sm" /> : null}
          </div>
        }
      />
      <Tabs.Tab
        name="inferred"
        value="inferred"
        label={
          <div>
            {t("settings.inferred")} {fetchingInferredFacesList ? <Loader size="sm" /> : null}
          </div>
        }
      />
    </Tabs>
  );
}
