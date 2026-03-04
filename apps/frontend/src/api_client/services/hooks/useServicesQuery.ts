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
      const results: Record<string, boolean> = {};
      const healthChecks = serviceNames.map(async name => {
        try {
          const response = await fetchClient.get(`/services/${name}/`);
          const parsed = parseWithNotification(ServiceHealthResponse, response, `Failed to parse health for ${name}`);
          results[name] = parsed.healthy;
        } catch {
          results[name] = false;
        }
      });
      await Promise.all(healthChecks);
      return results;
    },
    refetchInterval: 15000,
    enabled: (options?.enabled ?? true) && serviceNames.length > 0,
  });
