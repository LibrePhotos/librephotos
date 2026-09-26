import { LoginScreen } from "@/features/auth/LoginScreen";

// Server-URL-first login route. The auth gate in the root layout redirects to
// the tabs automatically once auth status flips to "authenticated".
export default function LoginRoute() {
  return <LoginScreen />;
}
