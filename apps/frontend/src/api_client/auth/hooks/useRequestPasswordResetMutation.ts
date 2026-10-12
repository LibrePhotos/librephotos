import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useRequestPasswordResetMutation = () =>
  useMutation({
    mutationFn: ({ email }: { email: string }) => endpoints.requestPasswordReset(apiClient, email),
  });
