import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient } from "../../api";
import { statsKeys } from "../keys";
import { PhotoMonthCountResponse } from "../types";

export const useFetchPhotoMonthCountQuery = () =>
  useQuery({
    queryKey: statsKeys.photoMonthCounts(),
    queryFn: async () => {
      const response = await apiClient.get("/photomonthcounts/");
      return parseWithNotification(PhotoMonthCountResponse, response, "Failed to parse photo month count");
    },
  });
