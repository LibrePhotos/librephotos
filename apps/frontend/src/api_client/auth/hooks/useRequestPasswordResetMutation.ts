import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient } from "../../api";

const PasswordResetResponse = z.object({
  status: z.boolean(),
  message: z.string(),
});

type PasswordResetResponse = z.infer<typeof PasswordResetResponse>;

type PasswordResetRequest = { email: string };

const requestPasswordReset = (data: PasswordResetRequest) =>
  apiClient
    .post<PasswordResetResponse>("/auth/password/reset/", data)
    .then(response =>
      parseWithNotification(PasswordResetResponse, response, "Failed to parse password reset response")
    );

export const useRequestPasswordResetMutation = () =>
  useMutation({
    mutationFn: requestPasswordReset,
  });
