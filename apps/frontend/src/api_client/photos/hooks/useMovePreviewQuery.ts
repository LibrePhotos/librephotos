import { endpoints, photoKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { selectionArgs, type PhotoSelection } from "../photoSelection";

/**
 * What moving the selected photos to `targetFolder` would do (#352): the photos and files that
 * move, those refused or already there, and the names taken in the folder. With `folderPattern`
 * (#2774, "" for none) also the photos without a date and each folder of a date. Off without a folder.
 */
export const useMovePreviewQuery = (selection: PhotoSelection, targetFolder: string | null, folderPattern = "") =>
  useQuery({
    queryKey: photoKeys.movePreview(selection, targetFolder ?? "", folderPattern),
    queryFn: () => {
      const [imageHashes, selectAll] = selectionArgs(selection);
      const target = { targetFolder: targetFolder ?? "", folderPattern };
      return endpoints.previewPhotosMove(apiClient, imageHashes, target, selectAll);
    },
    enabled: targetFolder !== null,
    // The folder's contents change outside the app: read it again each time.
    staleTime: 0,
    retry: false,
  });
