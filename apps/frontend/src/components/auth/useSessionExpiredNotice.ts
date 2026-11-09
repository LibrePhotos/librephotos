import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { notification } from "../../service/notifications";

/**
 * The login page loaded after a session ran out (`?session=expired`, api_client/session.ts) says so
 * once, then drops the parameter, so a reload does not say it again.
 */
export function useSessionExpiredNotice(expired: boolean, redirect: string | undefined): void {
  const navigate = useNavigate();
  const said = useRef(false);
  useEffect(() => {
    if (!expired || said.current) return;
    said.current = true;
    notification.invalidToken();
    void navigate({ to: "/login", search: { redirect }, replace: true });
  }, [expired, redirect, navigate]);
}
