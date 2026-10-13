import { endpoints, ResponseParseError, settingsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { notifyParseError } from "../../parseErrors";

export const useFetchTimezonesQuery = () =>
  useQuery({
    queryKey: settingsKeys.timezones(),
    // An answer that is no list of names (reported) or no JSON at all leaves the picker empty
    // instead of failing; a failed request still fails the query.
    queryFn: () =>
      endpoints.fetchTimezones(apiClient).catch((error: unknown) => {
        if (error instanceof ResponseParseError || error instanceof SyntaxError) {
          notifyParseError(error);
          return [];
        }
        throw error;
      }),
  });
