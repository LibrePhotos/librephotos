/**
 * Tiny dependency-free JWT payload decoder. We only ever read the `exp` claim,
 * so pulling in `jwt-decode` (and a base64 polyfill on RN) is overkill.
 *
 * This does NOT verify the signature — never trust these values for authz; the
 * server is authoritative. It exists purely to pre-emptively refresh a token
 * that is about to expire, avoiding a guaranteed-to-fail request.
 */
export function decodeJwtExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const json = base64UrlDecode(payload);
    const parsed = JSON.parse(json) as { exp?: number };
    return typeof parsed.exp === "number" ? parsed.exp : null;
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
  const g = globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } };
  if (g.Buffer) {
    return g.Buffer.from(padded, "base64").toString("utf-8");
  }
  throw new Error("No base64 decoder available in this runtime");
}
