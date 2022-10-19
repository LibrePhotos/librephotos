import { Loader, Tabs } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

type Props = {
  activeTab: number;
  width: number;
  changeTab: (tabIndex: number) => void;
  fetchingLabeledFacesList: boolean;
  fetchingInferredFacesList: boolean;
};

export function TabComponent({ activeTab, width, changeTab, fetchingLabeledFacesList, fetchingInferredFacesList }: Props) {
  const { t } = useTranslation();

  return (
    <Tabs style={{ width: width }} active={activeTab} onTabChange={changeTab}>
      <Tabs.Tab
        label={
          <div>
            {t("settings.labeled")} {fetchingLabeledFacesList ? <Loader size="sm" /> : null}
          </div>
        }
        name="labeled"
      />
      <Tabs.Tab
        name="inferred"
        label={
          <div>
            {t("settings.inferred")} {fetchingInferredFacesList ? <Loader size="sm" /> : null}
          </div>
        }
      />
    </Tabs>
  );
}
