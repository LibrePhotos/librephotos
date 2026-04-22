import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Cookies } from "react-cookie";
import { fetchClient } from "../../api";

const logout = () => {
  const cookies = new Cookies();
  return fetchClient.post("/auth/token/blacklist/", { refresh: cookies.get("refresh") });
};

export const useLogoutMutation = () => {
  const navigate = useNavigate();

  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      const cookies = new Cookies();
      cookies.remove("access");
      cookies.remove("refresh");
      cookies.remove("jwt");
      navigate({ to: "/login" });
    },
  });
};
