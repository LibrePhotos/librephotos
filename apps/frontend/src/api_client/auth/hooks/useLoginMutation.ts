import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { setAuthCookie } from "../../authCookies";

export const LoginPost = z.object({
  username: z.string(),
  password: z.string(),
});

export type LoginPost = z.infer<typeof LoginPost>;

export const LoginResponse = z.object({
  refresh: z.string(),
  access: z.string(),
});

export type LoginResponse = z.infer<typeof LoginResponse>;

const login = (credentials: LoginPost) =>
  fetchClient.post<LoginResponse>("/auth/token/obtain/", credentials).then(response => {
    const data = parseWithNotification(LoginResponse, response, "Failed to parse login response");
    setAuthCookie("access", data.access);
    setAuthCookie("refresh", data.refresh);
    return data;
  });

type UseLoginOptions = {
  navigateOnSuccess?: boolean;
};

export const useLoginMutation = (options?: UseLoginOptions) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const navigateOnSuccess = options?.navigateOnSuccess ?? true;

  return useMutation({
    mutationFn: login,
    onSuccess: () => {
      queryClient.invalidateQueries();
      if (navigateOnSuccess) {
        navigate({ to: "/" });
      }
    },
  });
};
