import type { DatePhotosGroup, PigPhoto } from "../../api_client/photos/types";

type NamedUser = Readonly<{ id: number; username: string; first_name: string; last_name: string }>;

/** The name a sharing user is shown by: their full name, else their username, else `fallback`. */
export function sharerName(owner: NamedUser | undefined, fallback: string): string {
  if (owner && owner.last_name.length + owner.first_name.length > 0) {
    return `${owner.first_name} ${owner.last_name}`;
  }
  return owner ? owner.username : fallback;
}

type SharerPhotos = Readonly<{ userId: number; photos: PigPhoto[] }>;

/** A user's group: complete, so its string id is only a key (a date album's id is a number). */
type SharerGroup = DatePhotosGroup & { id: string; numberOfItems: number; incomplete: false };

/**
 * The shared photos as one photo list with a group per user, so the page has one scroll container
 * and one layout pass instead of a photo list per user. Pig's group header shows the user where a
 * date group shows its place (cut with an ellipsis first) and the photo count where it shows the
 * date; the count is never a date, so it is left as it is.
 */
export function sharerPhotoGroups(
  groups: readonly SharerPhotos[],
  users: readonly NamedUser[] | undefined,
  {
    fallbackName,
    countLabel,
  }: Readonly<{ fallbackName: (userId: number) => string; countLabel: (count: number) => string }>
): SharerGroup[] {
  return groups.map(group => ({
    id: `user-${group.userId}`,
    location: sharerName(
      users?.find(user => user.id === group.userId),
      fallbackName(group.userId)
    ),
    date: countLabel(group.photos.length),
    items: group.photos,
    numberOfItems: group.photos.length,
    incomplete: false,
  }));
}
