import { POLL_IDLE_MS } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { serviceKeys } from "../keys";
import { ServiceHealthResponse, ServicesListResponse } from "../types";

export const useServicesListQuery = () =>
  useQuery({
    queryKey: serviceKeys.list(),
    queryFn: async () => {
      const response = await fetchClient.get("/services/");
      return parseWithNotification(ServicesListResponse, response, "Failed to parse services list");
    },
  });

export const useServicesHealthQuery = (serviceNames: string[], options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: serviceKeys.health(serviceNames),
    queryFn: async () => {
      const results: Record<string, ServiceHealthResponse> = {};
      const healthChecks = serviceNames.map(async name => {
        try {
          const response = await fetchClient.get(`/services/${name}/`);
          results[name] = parseWithNotification(ServiceHealthResponse, response, `Failed to parse health for ${name}`);
        } catch {
          results[name] = { service_name: name, healthy: false, enabled: true, feature_flag: null };
        }
      });
      await Promise.all(healthChecks);
      return results;
    },
    refetchInterval: POLL_IDLE_MS,
    enabled: (options?.enabled ?? true) && serviceNames.length > 0,
  });
