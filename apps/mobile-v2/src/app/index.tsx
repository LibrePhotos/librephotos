import { Redirect } from "expo-router";
import { useAuthStore } from "@/stores/auth";

/**
 * Root route (`/`) — the URL Expo Go opens when you scan the QR code, and the
 * target of any bare deep link. Without this file nothing matched `/` and the
 * app opened straight onto expo-router's "Unmatched Route" screen.
 *
 * It only redirects; it never renders UI. While auth status is still `unknown`
 * the root layout is showing its hydration spinner and this screen is not
 * mounted, but the guard is kept anyway so a re-render during hydration can
 * never bounce the user to the login screen before the stored token is read.
 */
export default function Index() {
  const status = useAuthStore((s) => s.status);

  if (status === "unknown") return null;
  return <Redirect href={status === "authenticated" ? "/photos" : "/login"} />;
}
