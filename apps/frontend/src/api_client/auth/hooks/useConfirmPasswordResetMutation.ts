import { endpoints, type PasswordResetConfirmRequest } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

export const useConfirmPasswordResetMutation = (options: MutationErrorOptions = {}) =>
  useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: (data: PasswordResetConfirmRequest) => endpoints.confirmPasswordReset(apiClient, data),
  });
