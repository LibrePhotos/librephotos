import { imageHashOf, type DatePhotosGroup, type PigPhoto } from "@librephotos/api-client";
import type { GridItem } from "@/components/PhotoTile";

/** Convert an api-client PigPhoto (online list shape) into a grid tile item. */
export function pigPhotoToItem(photo: PigPhoto): GridItem {
  const hash = imageHashOf(photo);
  return {
    key: photo.id ?? hash,
    photoId: photo.id ?? hash,
    imageHash: hash,
    type: photo.type ?? "image",
    dominantColor: photo.dominantColor ?? null,
    localUri: null,
  };
}

/** Flatten `grouped_photos` (date sections) into a single newest-first tile list. */
export function flattenGroupedPhotos(groups: DatePhotosGroup[] | undefined): GridItem[] {
  if (!groups) return [];
  const items: GridItem[] = [];
  for (const group of groups) {
    for (const photo of group.items) items.push(pigPhotoToItem(photo));
  }
  return items;
}
