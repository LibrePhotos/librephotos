import { endpoints, type PasswordResetConfirmRequest } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useConfirmPasswordResetMutation = () =>
  useMutation({
    mutationFn: (data: PasswordResetConfirmRequest) => endpoints.confirmPasswordReset(apiClient, data),
  });
