import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { settingsKeys } from "../keys";
import { Timezones } from "../types";

export const useFetchTimezonesQuery = () =>
  useQuery({
    queryKey: settingsKeys.timezones(),
    queryFn: async () => {
      const response = await fetchClient.get<string>("/timezones/");
      try {
        const timezones: unknown = JSON.parse(response);
        return parseWithNotification(Timezones, timezones, "Failed to parse timezones");
      } catch (_e) {
        return [];
      }
    },
  });
