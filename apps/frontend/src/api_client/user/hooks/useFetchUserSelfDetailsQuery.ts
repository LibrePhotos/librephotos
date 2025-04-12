import { z } from "zod";
import { UserSchema } from "../../../store/user/user.zod";
import { useQuery } from "@tanstack/react-query";

export const useFetchUserSelfDetailsQuery = (userId?: number) => {
  return useQuery({
    queryKey: ["user", userId],
    queryFn: async () => {
      const response = await fetch(`/api/user/${userId}/`);
      const data = await response.json();
      return UserSchema.parse(data);
    },
    enabled: !!userId,
  });
}; 