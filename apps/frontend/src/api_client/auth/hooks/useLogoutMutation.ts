import { useMutation } from "@tanstack/react-query";
import { Cookies } from "react-cookie";
import { fetchClient, redirectToLogin } from "../../api";
import { clearAuthCookies } from "../../authCookies";

const logout = () => {
  const cookies = new Cookies();
  return fetchClient.post("/auth/token/blacklist/", { refresh: cookies.get("refresh") });
};

export const useLogoutMutation = () =>
  useMutation({
    mutationFn: logout,
    // Whatever the server said. A refresh token that is already blacklisted --
    // a second click on Log out -- answers 401, but the user still asked to
    // be logged out; clearing the cookies only on success left them signed in.
    onSettled: () => {
      clearAuthCookies();
      // A full page load, not a router navigation: the login page read the
      // still cached "logged in" answer and bounced straight back into the app.
      redirectToLogin();
    },
  });
