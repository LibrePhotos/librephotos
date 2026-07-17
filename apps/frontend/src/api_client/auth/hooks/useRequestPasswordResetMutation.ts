import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";

export const PasswordResetRequest = z.object({
  email: z.string(),
});

export type PasswordResetRequest = z.infer<typeof PasswordResetRequest>;

export const PasswordResetResponse = z.object({
  status: z.boolean(),
  message: z.string(),
});

export type PasswordResetResponse = z.infer<typeof PasswordResetResponse>;

const requestPasswordReset = (data: PasswordResetRequest) =>
  fetchClient
    .post<PasswordResetResponse>("/auth/password/reset/", data)
    .then(response =>
      parseWithNotification(PasswordResetResponse, response, "Failed to parse password reset response")
    );

export const useRequestPasswordResetMutation = () =>
  useMutation({
    mutationFn: requestPasswordReset,
  });
