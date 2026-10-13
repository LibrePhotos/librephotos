import { authKeys, endpoints, userKeys, type SignupRequest } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { apiClient, queryClient } from "../../api";

export const useSignUpMutation = () =>
  useMutation({
    mutationFn: (data: SignupRequest) => endpoints.signUp(apiClient, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.firstTimeSetup() });
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
