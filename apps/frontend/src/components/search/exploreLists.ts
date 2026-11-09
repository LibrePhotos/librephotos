import { UNKNOWN_PERSON_NAME, type PlaceAlbumInfo, type ThingAlbumInfo } from "@librephotos/api-client";
import type { Person } from "../../api_client/albums/hooks/useFetchPeopleAlbumsQuery";

/** How many places and things the Explore page shows before "View all". */
const EXPLORE_TILES = 6;
/** How many people the Explore page's row holds; the People page has the rest. */
const EXPLORE_PEOPLE = 24;

/** The named people with the most faces first: the unknown-person group is no one to explore. */
export function explorePeople(people: readonly Person[]): Person[] {
  return people
    .filter(person => person.name !== UNKNOWN_PERSON_NAME && person.face_count > 0)
    .sort((a, b) => b.face_count - a.face_count)
    .slice(0, EXPLORE_PEOPLE);
}

/** A country's geolocation_level; a region, a city and a neighbourhood count up from it. */
const COUNTRY_LEVEL = 1;

/**
 * The places with the most photos, the most specific first: "Berlin" rather than "State of Berlin"
 * or "Germany", which hold the same photos and so would show the same cover. Countries only when
 * there are too few other places, and one tile per cover.
 */
export function explorePlaces(places: readonly PlaceAlbumInfo[]): PlaceAlbumInfo[] {
  const ranked = [...places]
    .filter(place => place.photo_count > 0)
    .sort((a, b) => b.photo_count - a.photo_count || b.geolocation_level - a.geolocation_level);
  const local = ranked.filter(place => place.geolocation_level > COUNTRY_LEVEL);
  const covers = new Set<string>();
  const shown: PlaceAlbumInfo[] = [];
  for (const place of local.length >= EXPLORE_TILES ? local : ranked) {
    const cover = place.cover_photos[0]?.image_hash;
    if (cover !== undefined && covers.has(cover)) continue;
    if (cover !== undefined) covers.add(cover);
    shown.push(place);
    if (shown.length === EXPLORE_TILES) break;
  }
  return shown;
}

/** The things with the most photos. */
export function exploreThings(things: readonly ThingAlbumInfo[]): ThingAlbumInfo[] {
  return [...things]
    .filter(thing => thing.photo_count > 0)
    .sort((a, b) => b.photo_count - a.photo_count)
    .slice(0, EXPLORE_TILES);
}

/** "street art" as "Street art": labels come lowercase from the classifier. */
export function displayLabel(label: string): string {
  return label.charAt(0).toLocaleUpperCase() + label.slice(1);
}

/** Whether a name matches the words searched for: every word starts a word of the name. */
export function matchesTerm(name: string, term: string): boolean {
  const words = term.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const nameWords = name.toLocaleLowerCase().split(/[\s,/-]+/);
  return words.every(word => nameWords.some(nameWord => nameWord.startsWith(word)));
}
