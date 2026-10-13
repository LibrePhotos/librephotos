import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

export const useRequestPasswordResetMutation = (options: MutationErrorOptions = {}) =>
  useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ email }: { email: string }) => endpoints.requestPasswordReset(apiClient, email),
  });
