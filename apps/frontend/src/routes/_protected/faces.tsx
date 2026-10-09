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
    tab: FacesTab.safeParse(search.tab).data ?? DEFAULT_VALUES.activeTab,
    method: FaceAnalysisMethod.safeParse(search.method).data ?? DEFAULT_VALUES.analysisMethod,
    orderBy: (search.orderBy as string) || DEFAULT_VALUES.orderBy,
    // 0 is a valid threshold ("show every suggestion"), so no || fallback here. Out-of-range
    // values are clamped, not reset: the NumberInput reports "150" while it is being typed,
    // and a reset to 70 would make the field jump mid-typing
    minConfidence:
      typeof search.minConfidence === "number" && Number.isFinite(search.minConfidence)
        ? Math.min(1, Math.max(0, search.minConfidence))
        : DEFAULT_VALUES.minConfidence,
  }),
});
