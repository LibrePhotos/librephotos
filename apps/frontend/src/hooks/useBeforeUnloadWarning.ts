import { useEffect } from "react";

/**
 * While `active`, closing or reloading the tab asks first. The browser shows
 * its own generic dialog ("Leave site?"); pages cannot set its text. In-app
 * navigation is not affected.
 */
export function useBeforeUnloadWarning(active: boolean) {
  useEffect(() => {
    if (!active) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}
