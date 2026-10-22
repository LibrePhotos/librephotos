import type { PhotosOutsideChoice } from "./ScanDirectoryChangeNotice";
import type { ScanDirectoryChange } from "./useScanDirectoryChange";

/**
 * How many photos Save moves to the user's trash (#2036): those outside a changed scan directory,
 * once counted, when the admin chose to move them. 0 otherwise, which keeps them.
 */
export function photosToTrash(
  change: Pick<ScanDirectoryChange, "changed" | "outsideCount">,
  choice: PhotosOutsideChoice
) {
  if (!change.changed || choice !== "trash") {
    return 0;
  }
  return change.outsideCount ?? 0;
}
