import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";

export const PasswordResetConfirmRequest = z.object({
  uid: z.string(),
  token: z.string(),
  new_password: z.string(),
});

export type PasswordResetConfirmRequest = z.infer<typeof PasswordResetConfirmRequest>;

export const PasswordResetConfirmResponse = z.object({
  status: z.boolean(),
  message: z.string(),
});

export type PasswordResetConfirmResponse = z.infer<typeof PasswordResetConfirmResponse>;

const confirmPasswordReset = (data: PasswordResetConfirmRequest) =>
  fetchClient
    .post<PasswordResetConfirmResponse>("/auth/password/reset/confirm/", data)
    .then(response =>
      parseWithNotification(PasswordResetConfirmResponse, response, "Failed to parse password reset response")
    );

export const useConfirmPasswordResetMutation = () =>
  useMutation({
    mutationFn: confirmPasswordReset,
  });
