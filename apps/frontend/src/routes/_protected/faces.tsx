import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { FaceAnalysisMethod, FacesOrderOption, FacesRouteOrder, FacesTab } from "../../api_client/faces";
import { FaceDashboard } from "../../components/facedashboard/FaceDashboard";

// Default values for URL parameters
const DEFAULT_VALUES = {
  activeTab: FacesTab.enum.inferred,
  analysisMethod: FaceAnalysisMethod.enum.clustering,
  orderBy: FacesOrderOption.enum.confidence,
  minConfidence: 0.7,
};

// Every parameter may be left out of a link, and one that is missing or invalid gets its
// default.
const FacesSearch = z.object({
  tab: FacesTab.default(DEFAULT_VALUES.activeTab).catch(DEFAULT_VALUES.activeTab),
  method: FaceAnalysisMethod.default(DEFAULT_VALUES.analysisMethod).catch(DEFAULT_VALUES.analysisMethod),
  // The backend matches "date" in any case, so a hand-typed ?orderBy=DATE still sorts by date
  orderBy: z
    .string()
    .transform(value => (value.toLowerCase() === "date" ? "date" : value))
    .pipe(FacesRouteOrder)
    .default(DEFAULT_VALUES.orderBy)
    .catch(DEFAULT_VALUES.orderBy),
  // 0 is a valid threshold ("show every suggestion"). Out-of-range values are clamped, not
  // reset: the NumberInput reports "150" while it is being typed, and a reset to 70 would
  // make the field jump mid-typing. z.number() turns NaN and Infinity away.
  minConfidence: z
    .number()
    .transform(value => Math.min(1, Math.max(0, value)))
    .default(DEFAULT_VALUES.minConfidence)
    .catch(DEFAULT_VALUES.minConfidence),
});

export const Route = createFileRoute("/_protected/faces")({
  component: FaceDashboard,
  validateSearch: FacesSearch,
});
