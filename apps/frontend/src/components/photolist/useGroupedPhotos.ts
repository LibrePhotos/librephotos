import type { DatePhotosGroup } from "@librephotos/api-client";
import { useMemo } from "react";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";

const NO_GROUPS: DatePhotosGroup[] = [];

/**
 * A date list's groups and the flat list of their photos (the lightbox's and the selection's
 * order), both read from the same answer in the same render. A flat list copied by an effect held
 * the last filter's photos for a render after the groups had changed.
 */
export function useGroupedPhotos(data: DatePhotosGroup[] | undefined) {
  const groups = data ?? NO_GROUPS;
  const photosFlat = useMemo(() => getPhotosFlatFromGroupedByDate(groups), [groups]);
  return { groups, photosFlat };
}
