import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient } from "../../api";
import { statsKeys } from "../keys";
import { LocationTimeline } from "../types";

export const useLocationTimelineQuery = () =>
  useQuery({
    queryKey: statsKeys.locationTimeline(),
    queryFn: async () => {
      const response = await apiClient.get("/locationtimeline/");
      return parseWithNotification(LocationTimeline, response, "Failed to parse location timeline");
    },
  });
