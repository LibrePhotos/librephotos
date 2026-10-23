import { Navigate } from "@tanstack/react-router";
import React from "react";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";

/**
 * The server's address for a visitor who is not signed in: the public gallery when the admin opened
 * it to everyone (#434), the login page otherwise, exactly as before the gallery. Blank for the one
 * request that tells them apart; a failed one goes to the login page.
 */
export function LoggedOutHome({ redirect }: Readonly<{ redirect: string }>) {
  const { data: settings, isPending } = useGetSettingsQuery();
  if (isPending) return null;
  if (settings?.public_gallery === "everyone") return <Navigate to="/public" replace />;
  return <Navigate to="/login" search={{ redirect }} replace />;
}
