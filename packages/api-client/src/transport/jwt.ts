/**
 * Tiny dependency-free JWT payload decoder. We only read the `exp` and
 * `user_id` claims, so pulling in `jwt-decode` (and a base64 polyfill on RN)
 * is overkill.
 *
 * This does NOT verify the signature — never trust these values for authz; the
 * server is authoritative. `exp` exists purely to pre-emptively refresh a token
 * that is about to expire, avoiding a guaranteed-to-fail request; `user_id`
 * tells a client which `/user/<id>/` is its own.
 */
export function decodeJwtExp(token: string): number | null {
  const claims = decodeJwtClaims(token);
  return claims && typeof claims.exp === "number" ? claims.exp : null;
}

/**
 * The signed-in user's id from an access token's `user_id` claim, or null.
 *
 * djangorestframework-simplejwt writes the claim as a string ("1") since 5.5.0
 * and wrote a number before, and a client may talk to a server on either side
 * of that, so both are read. Anything but a positive integer is null.
 */
export function userIdFromAccessToken(token: string | null): number | null {
  if (!token) return null;
  const raw = decodeJwtClaims(token)?.user_id;
  const id = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The payload of `token` when it is a JSON object, else null. */
function decodeJwtClaims(token: string): { exp?: unknown; user_id?: unknown } | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(payload));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** exp is in seconds since epoch. Treat as expired within a 5s skew window. */
export function isExpiryClose(exp: number, skewMs = 5000): boolean {
  return 1000 * exp - Date.now() < skewMs;
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");

  // Prefer atob (browser / Hermes / modern Node), fall back to Buffer (Node).
  if (typeof atob === "function") {
    const binary = atob(padded);
    // Decode UTF-8 bytes so multibyte claims survive (rare in JWT, but correct).
    let percent = "";
    for (let i = 0; i < binary.length; i += 1) {
      percent += `%${`00${binary.charCodeAt(i).toString(16)}`.slice(-2)}`;
    }
    try {
      return decodeURIComponent(percent);
    } catch {
      return binary;
    }
  }
  // Node's Buffer where there is one (it fits this shape); undefined elsewhere.
  const g: { Buffer?: { from(s: string, enc: "base64"): { toString(enc: "utf-8"): string } } } = globalThis;
  if (g.Buffer) {
    return g.Buffer.from(padded, "base64").toString("utf-8");
  }
  throw new Error("No base64 decoder available in this runtime");
}
