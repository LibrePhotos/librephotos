import { useQuery } from "@tanstack/react-query";
import { fetchClient } from "../../api";
import { authKeys } from "../keys";

export const useIsFirstTimeSetupQuery = () =>
  useQuery({
    queryKey: authKeys.firstTimeSetup(),
    queryFn: () =>
      fetchClient.get<{ isFirstTimeSetup: boolean }>("/firsttimesetup/").then(response => response.isFirstTimeSetup),
  });
