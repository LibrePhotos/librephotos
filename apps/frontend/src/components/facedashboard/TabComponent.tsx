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

export function TabComponent(props: Props) {
  const { t } = useTranslation();

  return (
    <Tabs style={{ width: props.width }} active={props.activeTab} onTabChange={props.changeTab}>
      <Tabs.Tab
        label={
          <div>
            {t("settings.labeled")} {props.fetchingLabeledFacesList ? <Loader size="sm" /> : null}
          </div>
        }
        name="labeled"
      ></Tabs.Tab>
      <Tabs.Tab
        name="inferred"
        label={
          <div>
            {t("settings.inferred")} {props.fetchingInferredFacesList ? <Loader size="sm" /> : null}
          </div>
        }
      ></Tabs.Tab>
    </Tabs>
  );
}
