import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { authKeys } from "../keys";

export const useIsFirstTimeSetupQuery = () =>
  useQuery({
    queryKey: authKeys.firstTimeSetup(),
    queryFn: () =>
      apiClient.get<{ isFirstTimeSetup: boolean }>("/firsttimesetup/").then(response => response.isFirstTimeSetup),
  });
