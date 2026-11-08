import { FaceAnalysisMethod } from "@librephotos/api-client";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PersonGroupParam } from "../../components/album/personGroupSearch";
import { FaceDashboard } from "../../components/facedashboard/FaceDashboard";
import {
  FACES_SEARCH_DEFAULTS as DEFAULT_VALUES,
  FacesPersonOrder,
  FacesRouteOrder,
  FacesTab,
} from "../../components/facedashboard/facesTab";

// Every parameter may be left out of a link, and one that is missing or invalid gets its
// default.
const FacesSearch = z.object({
  tab: FacesTab.default(DEFAULT_VALUES.tab).catch(DEFAULT_VALUES.tab),
  method: FaceAnalysisMethod.default(DEFAULT_VALUES.method).catch(DEFAULT_VALUES.method),
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
  // The order of the people, not of their faces (#764)
  personOrder: FacesPersonOrder.default(DEFAULT_VALUES.personOrder).catch(DEFAULT_VALUES.personOrder),
  // Only the people of one group (#1126); left out for everybody
  group: PersonGroupParam,
  // Only one person's faces: a person page's "Review faces"; left out for everybody
  person: z.number().int().positive().optional().catch(undefined),
});

export const Route = createFileRoute("/_protected/faces")({
  component: FaceDashboard,
  validateSearch: FacesSearch,
});
