import { useQuery } from "@tanstack/react-query";
import { fetchClient } from "../../api";

export const IsFirstTimeSetupQueryKeys = ['isFirstTimeSetup'] as const;

export const useIsFirstTimeSetupQuery = () => {
  return useQuery({
    queryKey: [IsFirstTimeSetupQueryKeys],
    queryFn: () =>  fetchClient.get<{ isFirstTimeSetup: boolean }>('/firsttimesetup/')
    .then(response => response.isFirstTimeSetup),
  });
};
