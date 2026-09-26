import { useEffect, useState } from "react";
import { tokenStorage } from "@/lib/tokenStorage";
import { useAuthStore } from "@/stores/auth";

/**
 * Read the current access token from secure-store into React state so it can be
 * attached as an Authorization header on image requests (expo-image has no
 * cookie jar). Re-reads whenever auth status changes (login/logout/refresh).
 */
export function useAccessToken(): string | null {
  const status = useAuthStore(s => s.status);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.resolve(tokenStorage.getAccessToken()).then((value: string | null) => {
      if (active) setToken(value);
    });
    return () => {
      active = false;
    };
  }, [status]);

  return token;
}
