import { useQuery } from "@tanstack/react-query";
import { fetchClient } from "../../api";

export const QueryKeys = ["isFirstTimeSetup"]

export const useIsFirstTimeSetupQuery = () => {
  return useQuery({
    queryKey: [QueryKeys],
    queryFn: () =>  fetchClient.get<{ isFirstTimeSetup: boolean }>('/firsttimesetup/')
    .then(response => response.isFirstTimeSetup),
  });
};
