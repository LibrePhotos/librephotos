import { endpoints, photoKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { selectionArgs, type PhotoSelection } from "../photoSelection";

/**
 * What renaming the selected photos with `pattern` would do (#2773): the photos that get a new
 * name, those that keep theirs and why, and the first ones with their new names. Off without a pattern.
 */
export const useRenamePreviewQuery = (selection: PhotoSelection, pattern: string | null) =>
  useQuery({
    queryKey: photoKeys.renamePreview(selection, pattern ?? ""),
    queryFn: () => {
      const [imageHashes, selectAll] = selectionArgs(selection);
      return endpoints.previewPhotosRename(apiClient, imageHashes, pattern ?? "", selectAll);
    },
    enabled: pattern !== null,
    // The folders change outside the app: read them again each time.
    staleTime: 0,
    retry: false,
  });
