import { authKeys, endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useIsFirstTimeSetupQuery = () =>
  useQuery({
    queryKey: authKeys.firstTimeSetup(),
    queryFn: () => endpoints.fetchIsFirstTimeSetup(apiClient).then(response => response.isFirstTimeSetup),
  });
