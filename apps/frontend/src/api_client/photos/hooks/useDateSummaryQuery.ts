import { endpoints, photoKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { selectionArgs, type PhotoSelection } from "../photoSelection";

/**
 * How many of the selected photos have a date, and the oldest and newest of them (#2278): the
 * date dialog's preview. Asked only while the dialog is open, and dropped when it closes: the dialog
 * starts from these dates, so it never opens on the ones from before a change.
 */
export const useDateSummaryQuery = (selection: PhotoSelection, enabled: boolean) => {
  const [imageHashes, selectAll] = selectionArgs(selection);
  return useQuery({
    queryKey: photoKeys.dateSummary(imageHashes, selectAll),
    queryFn: () => endpoints.fetchDateSummary(apiClient, imageHashes, selectAll),
    enabled,
    gcTime: 0,
  });
};
