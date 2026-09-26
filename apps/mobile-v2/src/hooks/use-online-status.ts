import { useEffect, useState } from "react";
import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";

/**
 * Live connectivity flag (expo-network). Drives the offline indicator in the app
 * chrome and the disabled state of online-only mutation actions (doc 03 §6).
 * Optimistic default of `true` so nothing flickers disabled on first paint.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let active = true;
    void getNetworkStateAsync().then((s) => {
      if (active) setOnline(s.isConnected !== false);
    });
    const sub = addNetworkStateListener(({ isConnected }) => {
      if (active) setOnline(isConnected !== false);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  return online;
}
