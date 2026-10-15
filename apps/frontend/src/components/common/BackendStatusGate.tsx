import React from "react";
import { useBackendStatus } from "../../api_client/server";
import { BackendStatusScreen } from "./BackendStatusScreen";

/**
 * Takes over the page, login or app, while the server is down, starting or updating its database
 * (#2310), and gives it back when the readiness probe answers 200. The page stays mounted under
 * the screen (inert), so a short restart keeps the user where they were.
 */
export function BackendStatusGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const { status, checkNow } = useBackendStatus();
  const down = status.kind === "down";
  return (
    <>
      <div inert={down}>{children}</div>
      {down && <BackendStatusScreen status={status} onCheckNow={checkNow} />}
    </>
  );
}
