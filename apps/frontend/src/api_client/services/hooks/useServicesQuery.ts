import { endpoints, POLL_IDLE_MS, type ServiceHealth } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { notifyParseError } from "../../parseErrors";
import { serviceKeys } from "../keys";

export const useServicesListQuery = () =>
  useQuery({
    queryKey: serviceKeys.list(),
    queryFn: () => endpoints.fetchServices(apiClient),
  });

export const useServicesHealthQuery = (serviceNames: string[], options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: serviceKeys.health(serviceNames),
    queryFn: async () => {
      const results: Record<string, ServiceHealth> = {};
      const healthChecks = serviceNames.map(async name => {
        try {
          results[name] = await endpoints.fetchServiceHealth(apiClient, name);
        } catch (error) {
          // A failed check counts as unhealthy and fails nothing else, so the QueryClient never
          // sees an answer that did not parse: report it here.
          notifyParseError(error);
          results[name] = { service_name: name, healthy: false, enabled: true, feature_flag: null };
        }
      });
      await Promise.all(healthChecks);
      return results;
    },
    refetchInterval: POLL_IDLE_MS,
    enabled: (options?.enabled ?? true) && serviceNames.length > 0,
  });
