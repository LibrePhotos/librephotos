import type { People } from "../api_client/albums/hooks/useFetchPeopleAlbumsQuery";

const STORAGE_KEY = "recentlyTaggedPeople";

// How many people the "Recently tagged" shortcut keeps around.
export const RECENTLY_TAGGED_PEOPLE_LIMIT = 5;

// Faces carry a numeric person id, people albums coerce the same id to a string.
// The MRU stores strings and normalizes at the boundary.
export type RecentlyTaggedPersonId = string;

const listeners = new Set<() => void>();

// Reads the MRU, most recently tagged person first.
export function getRecentlyTaggedPeopleIds(): RecentlyTaggedPersonId[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Error loading recently tagged people from localStorage:", e);
    return [];
  }
}

export function subscribeToRecentlyTaggedPeople(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Error saving recently tagged people to localStorage:", e);
  }
  listeners.forEach(listener => listener());
}

// Resolves the stored ids against the people the server currently knows about.
// Entries that no longer exist (deleted or merged people) are dropped instead of
// rendered with a stale name.
export function resolveRecentlyTaggedPeople(ids: RecentlyTaggedPersonId[], people: People | undefined): People {
  if (!people) {
    return [];
  }
  return ids.map(id => people.find(person => person.id === id)).filter((person): person is People[number] => !!person);
}
