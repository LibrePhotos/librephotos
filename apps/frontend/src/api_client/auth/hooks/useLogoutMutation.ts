import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Cookies } from "react-cookie";
import { fetchClient } from "../../api";
import { clearAuthCookies } from "../../authCookies";

const logout = () => {
  const cookies = new Cookies();
  return fetchClient.post("/auth/token/blacklist/", { refresh: cookies.get("refresh") });
};

export const useLogoutMutation = () => {
  const navigate = useNavigate();

  return useMutation({
    mutationFn: logout,
    // Whatever the server said. A refresh token that is already blacklisted --
    // a second click on Log out -- answers 401, and the user still asked to
    // be logged out; only on success, they stayed signed in.
    onSettled: () => {
      clearAuthCookies();
      navigate({ to: "/login" });
    },
  });
};
