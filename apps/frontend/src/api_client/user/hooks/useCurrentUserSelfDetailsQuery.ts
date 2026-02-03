import { useAccessToken } from "../../auth/hooks";
import { useFetchUserSelfDetailsQuery } from "./useFetchUserSelfDetailsQuery";

export const useCurrentUserSelfDetailsQuery = (skip: boolean = false) => {
  const { data: auth } = useAccessToken();
  return useFetchUserSelfDetailsQuery(skip ? "" : (auth?.access?.user_id?.toString() ?? ""));
};
