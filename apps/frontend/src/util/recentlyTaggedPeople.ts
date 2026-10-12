import { z } from "zod";
import type { PersonList } from "../api_client/albums/hooks/useFetchPeopleAlbumsQuery";
import { readStored, STORAGE_KEYS, subscribeStored, writeStored } from "./storage";

// How many people the "Recently tagged" shortcut keeps around.
export const RECENTLY_TAGGED_PEOPLE_LIMIT = 5;

// Faces carry a numeric person id, people albums coerce the same id to a string.
// The MRU stores strings and normalizes at the boundary.
export type RecentlyTaggedPersonId = string;

// Anything but a list is no list, and entries that are not strings are left out.
const StoredIds = z
  .array(z.unknown())
  .transform(ids => ids.filter((id): id is string => typeof id === "string"))
  .catch([]);

// Reads the MRU, most recently tagged person first.
export function getRecentlyTaggedPeopleIds(): RecentlyTaggedPersonId[] {
  return readStored(STORAGE_KEYS.recentlyTaggedPeople, StoredIds, []);
}

export function subscribeToRecentlyTaggedPeople(listener: () => void) {
  return subscribeStored(STORAGE_KEYS.recentlyTaggedPeople, listener);
}

// Moves `id` to the front, keeping the rest in order and dropping the oldest
// entries once the list is full.
export function withMostRecentlyTagged(
  ids: RecentlyTaggedPersonId[],
  id: RecentlyTaggedPersonId,
  limit: number = RECENTLY_TAGGED_PEOPLE_LIMIT
): RecentlyTaggedPersonId[] {
  return [id, ...ids.filter(existing => existing !== id)].slice(0, limit);
}

export function recordRecentlyTaggedPerson(personId: string | number | null | undefined) {
  if (personId === null || personId === undefined || personId === "") {
    return;
  }

  const ids = withMostRecentlyTagged(getRecentlyTaggedPeopleIds(), personId.toString());
  writeStored(STORAGE_KEYS.recentlyTaggedPeople, ids);
}

// Resolves the stored ids against the people the server currently knows about.
// Entries that no longer exist (deleted or merged people) are dropped instead of
// rendered with a stale name.
export function resolveRecentlyTaggedPeople(ids: RecentlyTaggedPersonId[], people: PersonList | undefined): PersonList {
  if (!people) {
    return [];
  }
  return ids
    .map(id => people.find(person => person.id === id))
    .filter((person): person is PersonList[number] => !!person);
}
