import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient } from "../../api";

const PasswordResetConfirmResponse = z.object({
  status: z.boolean(),
  message: z.string(),
});

type PasswordResetConfirmResponse = z.infer<typeof PasswordResetConfirmResponse>;

type PasswordResetConfirmRequest = { uid: string; token: string; new_password: string };

const confirmPasswordReset = (data: PasswordResetConfirmRequest) =>
  apiClient
    .post<PasswordResetConfirmResponse>("/auth/password/reset/confirm/", data)
    .then(response =>
      parseWithNotification(PasswordResetConfirmResponse, response, "Failed to parse password reset response")
    );

export const useConfirmPasswordResetMutation = () =>
  useMutation({
    mutationFn: confirmPasswordReset,
  });
