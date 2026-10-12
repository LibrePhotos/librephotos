import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { userKeys } from "../../user/keys";
import { authKeys } from "../keys";

const UserSignupResponse = z.object({
  username: z.string(),
  email: z.string(),
  first_name: z.string(),
  last_name: z.string(),
});
type UserSignupResponse = z.infer<typeof UserSignupResponse>;

type UserSignupRequest = { username: string; password: string; email: string; first_name: string; last_name: string };

const signUp = (data: UserSignupRequest) =>
  fetchClient
    .post<UserSignupResponse>("/user/", data)
    .then(response => parseWithNotification(UserSignupResponse, response, "Failed to parse signup response"));

export const useSignUpMutation = () =>
  useMutation({
    mutationFn: signUp,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.firstTimeSetup() });
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
