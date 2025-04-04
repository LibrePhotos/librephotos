import { Group, Loader, Tabs } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { faceActions } from "../../store/faces/faceSlice";
import { FaceAnalysisMethod, FacesTab } from "../../store/faces/facesActions.types";
import { FacesCountersHoverCard } from "./FacesCountersHoverCard";

type Props = Readonly<{
  width: number;
  fetchingLabeledFacesList: boolean;
  fetchingInferredFacesList: boolean;
  activeTab?: FacesTab;
  onTabChange?: (tab: FacesTab) => void;
  analysisMethod?: FaceAnalysisMethod;
  onMethodChange?: (method: string) => void;
  orderBy?: string;
  onOrderChange?: (orderBy: string) => void;
  minConfidence?: number;
  onConfidenceChange?: (confidence: number) => void;
}>;

export function TabComponent({ 
  width, 
  fetchingLabeledFacesList, 
  fetchingInferredFacesList,
  activeTab: propActiveTab,
  onTabChange,
}: Props) {

  
  const changeTab = (value: string | null) => {
    if (value && onTabChange) {
      onTabChange(value as FacesTab);
    } 
  };
  
  const { t } = useTranslation();

  return (
    <Group justify="apart">
      <Tabs defaultValue={propActiveTab} value={propActiveTab} style={{ width }} onChange={changeTab}>
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
