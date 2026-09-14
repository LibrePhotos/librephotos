import { useEffect } from "react";

/**
 * Keeps the screen awake while `active` is true (Screen Wake Lock API).
 *
 * A phone that dims and locks mid-upload aborts the in-flight requests with a
 * network error. Browsers without support, or that refuse the lock (low power
 * mode, background tab), simply carry on without it.
 */
export function useScreenWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      return undefined;
    }
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await lock.release();
        } else {
          sentinel = lock;
        }
      } catch {
        // refused: nothing to do, the upload keeps running
      }
    };

    // The browser drops the lock when the tab is hidden; re-request it on return.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
