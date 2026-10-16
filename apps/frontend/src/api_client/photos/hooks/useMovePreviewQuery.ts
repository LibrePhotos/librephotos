import { endpoints, photoKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { selectionArgs, type PhotoSelection } from "../photoSelection";

/**
 * What moving the selected photos to `targetFolder` would do (#352): the photos and files that
 * move, those refused or already there, and the names taken in the folder. Off without a folder.
 */
export const useMovePreviewQuery = (selection: PhotoSelection, targetFolder: string | null) =>
  useQuery({
    queryKey: photoKeys.movePreview(selection, targetFolder ?? ""),
    queryFn: () => {
      const [imageHashes, selectAll] = selectionArgs(selection);
      return endpoints.previewPhotosMove(apiClient, imageHashes, targetFolder ?? "", selectAll);
    },
    enabled: targetFolder !== null,
    // The folder's contents change outside the app: read it again each time.
    staleTime: 0,
    retry: false,
  });
