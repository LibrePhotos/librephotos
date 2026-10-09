import type { LocationTimeline } from "../../api_client/stats/types";

/**
 * Data and series for the stacked Location Timeline bar.
 *
 * The backend returns one entry per stay, so a place visited twice appears
 * twice. Keying the bar by place name let the last stay overwrite the earlier
 * ones (wrong widths, every segment showing the last stay's dates), so each
 * stay gets its own key and keeps the place only as its label.
 */
export function locationTimelineChart(locationTimeline: LocationTimeline) {
  const data: Record<string, number | string> = { label: "" };
  const series = locationTimeline.map((el, i) => {
    const name = `stay${i}`;
    const [duration] = el.data;
    data[name] = duration;
    return { name, label: el.loc, color: el.color };
  });
  return { data: locationTimeline.length > 0 ? [data] : [], series };
}

/** The stay a series name from `locationTimelineChart` stands for. */
export function stayForSeries(locationTimeline: LocationTimeline, seriesName: string) {
  return locationTimeline[Number(seriesName.replace("stay", ""))];
}
