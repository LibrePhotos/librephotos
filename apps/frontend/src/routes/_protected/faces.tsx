import { createFileRoute } from "@tanstack/react-router";
import { FaceAnalysisMethod, FacesTab } from "../../api_client/faces";
import { FaceDashboard } from "../../components/facedashboard/FaceDashboard";

type FacesSearch = {
  tab: FacesTab;
  method: FaceAnalysisMethod;
  orderBy: string;
  minConfidence: number;
};

// Default values for URL parameters
const DEFAULT_VALUES = {
  activeTab: FacesTab.enum.inferred,
  analysisMethod: FaceAnalysisMethod.enum.clustering,
  orderBy: "confidence",
  minConfidence: 0.7,
};

export const Route = createFileRoute("/_protected/faces")({
  component: FaceDashboard,
  validateSearch: (search: Record<string, unknown>): FacesSearch => ({
    tab: (search.tab as FacesTab) || DEFAULT_VALUES.activeTab,
    method: (search.method as FaceAnalysisMethod) || DEFAULT_VALUES.analysisMethod,
    orderBy: (search.orderBy as string) || DEFAULT_VALUES.orderBy,
    minConfidence: (search.minConfidence as number) || DEFAULT_VALUES.minConfidence,
  }),
});
