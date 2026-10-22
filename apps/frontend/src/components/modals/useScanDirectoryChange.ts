import { useDebouncedValue } from "@mantine/hooks";
import { useTrashPhotosOutsideLibraryMutation } from "../../api_client/jobs/hooks/useTrashPhotosOutsideLibraryMutation";
import { useScanDirectoryImpactQuery } from "../../api_client/user/hooks/useScanDirectoryImpactQuery";

/** How long typing in the path waits before the photos are counted. */
const COUNT_DELAY_MS = 400;

type Input = Readonly<{
  /** The edited user; none while creating one, which has no photos yet. */
  userId: number | undefined;
  savedScanDirectory: string | undefined;
  scanDirectory: string;
  uploadDirectory: string;
  /** The picker found the typed folder. */
  isPathValid: boolean;
}>;

export type ScanDirectoryChange = Readonly<{
  /** Another existing folder than the saved one is picked for a user who had one. */
  changed: boolean;
  /** The user's photos outside it; null while counting. */
  outsideCount: number | null;
  /** The count failed: nothing is offered, and the photos stay. */
  countFailed: boolean;
  /** Starts the job that moves those photos to the user's trash, after the save (#2036). */
  trashOutside: (username: string, count: number) => void;
}>;

/** The user edit dialog's view of a changed scan directory (#2036). */
export function useScanDirectoryChange(input: Input): ScanDirectoryChange {
  const { userId, savedScanDirectory, scanDirectory, uploadDirectory, isPathValid } = input;
  const [debouncedPath] = useDebouncedValue(scanDirectory, COUNT_DELAY_MS);
  const changed =
    userId !== undefined &&
    !!savedScanDirectory &&
    !!scanDirectory &&
    scanDirectory !== savedScanDirectory &&
    isPathValid;
  const settled = changed && debouncedPath === scanDirectory;
  const impact = useScanDirectoryImpactQuery({
    userId: userId ?? 0,
    scanDirectory: debouncedPath,
    uploadDirectory,
    enabled: settled,
  });
  const { mutate } = useTrashPhotosOutsideLibraryMutation();
  return {
    changed,
    outsideCount: settled && impact.data ? impact.data.outside_count : null,
    countFailed: settled && impact.isError,
    trashOutside: (username, count) => {
      if (userId !== undefined) mutate({ userId, username, count });
    },
  };
}
