import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { ServiceHealthResponse, ServicesListResponse } from "../types";

export const ServicesQueryKeys = ["services"] as const;
export const ServiceHealthQueryKeys = ["serviceHealth"] as const;

export const useServicesListQuery = () =>
  useQuery({
    queryKey: [...ServicesQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get("/services/");
      return parseWithNotification(ServicesListResponse, response, "Failed to parse services list");
    },
  });

export const useServicesHealthQuery = (serviceNames: string[], options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [...ServiceHealthQueryKeys, serviceNames],
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
    refetchInterval: 15000,
    enabled: (options?.enabled ?? true) && serviceNames.length > 0,
  });
