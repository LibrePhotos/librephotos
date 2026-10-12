import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient } from "../../api";
import { statsKeys } from "../keys";
import { LocationSunburst } from "../types";

export const useFetchLocationTreeQuery = () =>
  useQuery({
    queryKey: statsKeys.locationTree(),
    queryFn: async () => {
      const response = await apiClient.get("/locationsunburst/");
      return parseWithNotification(LocationSunburst, response, "Failed to parse location tree");
    },
  });
