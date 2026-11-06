import type { LocationTimeline } from "@librephotos/api-client";
import { LOCATION_TIMELINE_COLORS, LOCATION_TIMELINE_OTHER_COLOR } from "../../theme/chartColors";

/** One entry of the legend: a place, or `null` for the places grouped as "Other". */
type LocationLegendEntry = { label: string | null; color: string };

/**
 * One colour per place: the places with the most time get the palette in that order, the rest
 * share the "Other" colour. A place visited twice keeps its colour, so the legend names it once.
 */
function placeColors(locationTimeline: LocationTimeline) {
  const totals = new Map<string, number>();
  for (const stay of locationTimeline) {
    totals.set(stay.loc, (totals.get(stay.loc) ?? 0) + (stay.data[0] ?? 0));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([place]) => place);
  const colors = new Map<string, string>();
  const legend: LocationLegendEntry[] = [];
  ranked.forEach((place, index) => {
    const color = LOCATION_TIMELINE_COLORS[index];
    colors.set(place, color ?? LOCATION_TIMELINE_OTHER_COLOR);
    if (color) legend.push({ label: place, color });
  });
  if (ranked.length > LOCATION_TIMELINE_COLORS.length) {
    legend.push({ label: null, color: LOCATION_TIMELINE_OTHER_COLOR });
  }
  return { colors, legend };
}

/**
 * Data, series and legend for the stacked Location Timeline bar.
 *
 * The backend returns one entry per stay, so a place visited twice appears
 * twice. Keying the bar by place name let the last stay overwrite the earlier
 * ones (wrong widths, every segment showing the last stay's dates), so each
 * stay gets its own key and keeps the place only as its label. The colour is
 * the place's, not the stay's.
 */
export function locationTimelineChart(locationTimeline: LocationTimeline) {
  const { colors, legend } = placeColors(locationTimeline);
  const data: Record<string, number | string> = { label: "" };
  const series = locationTimeline.map((el, i) => {
    const name = `stay${i}`;
    const [duration] = el.data;
    if (duration !== undefined) data[name] = duration;
    return { name, label: el.loc, color: colors.get(el.loc) ?? LOCATION_TIMELINE_OTHER_COLOR };
  });
  return { data: locationTimeline.length > 0 ? [data] : [], series, legend };
}

/** The stay a series name from `locationTimelineChart` stands for. */
export function stayForSeries(locationTimeline: LocationTimeline, seriesName: string) {
  return locationTimeline[Number(seriesName.replace("stay", ""))];
}
