import {
  endpoints,
  POLL_BACKEND_STATUS_MS,
  pollUntil,
  serverKeys,
  type BackendNotReady,
  type BackendReadiness,
  type ImageTag,
} from "@librephotos/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { backendTroubleSince, clearBackendTrouble, subscribeBackendTrouble } from "../backendTrouble";

export type BackendStatus =
  | { kind: "serving" }
  | {
      kind: "down";
      readiness: BackendNotReady;
      /** When the first request failed to reach the server (ms since the epoch). */
      since: number;
      /** When the readiness probe last answered; the next check is POLL_BACKEND_STATUS_MS later. */
      checkedAt: number;
      /** The release that is starting, or the one this tab last talked to; null when neither is known. */
      version: string | null;
    };

type Down = { readiness: BackendNotReady; checkedAt: number };

const isReady = (readiness: BackendReadiness) => readiness.state === "ready";

/** One check at once, then one every POLL_BACKEND_STATUS_MS until the server serves again. */
async function waitUntilReady(check: () => Promise<BackendReadiness>, signal: AbortSignal): Promise<void> {
  if (isReady(await check())) {
    return;
  }
  await pollUntil(check, { isDone: isReady, intervalMs: POLL_BACKEND_STATUS_MS, signal });
}

/**
 * Whether the server serves requests (#2310). Quiet until a request fails to reach it
 * (backendTrouble.ts); then it asks the readiness probe at once, so a lone 504 from one slow
 * request changes nothing, and reports the server `down` until the probe answers 200. When a
 * `down` server serves again, every query refetches and a toast says so. `checkNow` asks again
 * at once instead of waiting for the next check.
 */
export function useBackendStatus(): { status: BackendStatus; checkNow: () => void } {
  const queryClient = useQueryClient();
  const since = useSyncExternalStore(subscribeBackendTrouble, backendTroubleSince);
  const [down, setDown] = useState<Down | null>(null);
  const [round, setRound] = useState(0);
  // Read when the server is back, from whichever round of checks saw it: whether the screen showed.
  const wasDown = useRef(false);

  useEffect(() => {
    if (since === null) {
      return undefined;
    }
    const controller = new AbortController();
    const check = async () => {
      const readiness = await endpoints.fetchBackendReadiness(apiClient);
      if (!controller.signal.aborted && readiness.state !== "ready") {
        wasDown.current = true;
        setDown({ readiness, checkedAt: Date.now() });
      }
      return readiness;
    };
    const recovered = () => {
      if (controller.signal.aborted) {
        return;
      }
      setDown(null);
      clearBackendTrouble();
      if (wasDown.current) {
        wasDown.current = false;
        notification.backendBack();
        void queryClient.invalidateQueries();
      }
    };
    // A rejection is the abort below: Check now or unmounting ended this round.
    void waitUntilReady(check, controller.signal).then(recovered, () => {});
    return () => controller.abort();
  }, [since, round, queryClient]);

  const checkNow = useCallback(() => setRound(value => value + 1), []);

  if (since === null || down === null) {
    return { status: { kind: "serving" }, checkNow };
  }
  const version =
    down.readiness.version ?? queryClient.getQueryData<ImageTag>(serverKeys.imageTag())?.image_tag ?? null;
  return { status: { kind: "down", since, ...down, version }, checkNow };
}
