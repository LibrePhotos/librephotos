/**
 * A place name as the geocoder gives it, "Baixa, Lisbon, Portugal", in the parts the lightbox
 * shows. Its levels go from the most local to the country. A level that names several places at
 * once ("Diamond Head / Kapahulu / Saint Louis Heights", OpenStreetMap's neighbourhood list) counts
 * as its first.
 */
function placeLevels(place: string): string[] {
  return place
    .split(",")
    .map(level => level.split(/\s+\/\s+/)[0]?.trim() ?? "")
    .filter(Boolean);
}

/** The first two levels, "Baixa, Lisbon" or "Diamond Head, Honolulu County": where, briefly. */
export function shortPlace(place: string): string {
  return placeLevels(place).slice(0, 2).join(", ");
}

/** The levels after shortPlace's, "Portugal" or "Hawaii, United States"; empty when there are none. */
export function placeRegion(place: string): string {
  return placeLevels(place).slice(2).join(", ");
}
