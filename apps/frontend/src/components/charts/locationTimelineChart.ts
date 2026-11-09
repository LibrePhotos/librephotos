import type { LocationTimeline } from "@librephotos/api-client";

/** One entry of the legend: a place, or `null` for the places grouped as "Other". */
type LocationLegendEntry = { label: string | null; color: string };

type ColorScheme = "light" | "dark";

/**
 * The places with the most time, in five steps of the theme's accent scale: the accent itself
 * first (the scheme's filled shade: 6 on a light page, the pastel 2 on a dark one), then steps
 * spread in lightness so two neighbouring stays never look alike.
 */
const PLACE_STEPS: Record<ColorScheme, ReadonlyArray<number>> = {
  light: [6, 9, 4, 2, 1],
  dark: [2, 6, 0, 4, 8],
};

/** Every other place: a neutral grey, so only the named places carry the accent. */
const OTHER_PLACES: Record<ColorScheme, string> = {
  light: "var(--mantine-color-gray-5)",
  dark: "var(--mantine-color-dark-3)",
};

/**
 * One colour per place: the places with the most time get the accent's steps, the rest share
 * the "Other" grey. A place visited twice keeps its colour, so the legend names it once. The legend
 * reads like the bar, left to right by each place's first stay, "Other" last.
 */
function placeColors(locationTimeline: LocationTimeline, scheme: ColorScheme) {
  const tints = PLACE_STEPS[scheme].map(step => `var(--mantine-primary-color-${step})`);
  const other = OTHER_PLACES[scheme];
  const totals = new Map<string, number>();
  for (const stay of locationTimeline) {
    totals.set(stay.loc, (totals.get(stay.loc) ?? 0) + (stay.data[0] ?? 0));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([place]) => place);
  const colors = new Map<string, string>();
  ranked.forEach((place, index) => colors.set(place, tints[index] ?? other));
  // Map keys keep their insertion order: the places in the order of their first stay
  const legend: LocationLegendEntry[] = [...totals.keys()].flatMap(place => {
    const color = colors.get(place);
    return color && color !== other ? [{ label: place, color }] : [];
  });
  if (ranked.length > tints.length) {
    legend.push({ label: null, color: other });
  }
  return { colors, legend, other };
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
export function locationTimelineChart(locationTimeline: LocationTimeline, scheme: ColorScheme) {
  const { colors, legend, other } = placeColors(locationTimeline, scheme);
  const data: Record<string, number | string> = { label: "" };
  const series = locationTimeline.map((el, i) => {
    const name = `stay${i}`;
    const [duration] = el.data;
    if (duration !== undefined) data[name] = duration;
    return { name, label: el.loc, color: colors.get(el.loc) ?? other };
  });
  return { data: locationTimeline.length > 0 ? [data] : [], series, legend };
}

/** The stay a series name from `locationTimelineChart` stands for. */
export function stayForSeries(locationTimeline: LocationTimeline, seriesName: string) {
  return locationTimeline[Number(seriesName.replace("stay", ""))];
}
