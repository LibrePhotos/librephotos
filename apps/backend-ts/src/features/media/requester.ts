// Who is asking for media, resolved like the "cookie-optional" auth mode
// (DRF + the jwt cookie <img> tags send) but without its user query on the
// hot path: a well-formed access token only names a user id here, and the
// photo lookup checks that user (exists, active) in the same statement. Any
// other shape of credentials goes through the shared resolver, so the error
// answers (401s for a bad bearer token, Basic auth) stay exactly the same.
import { cookieValue, resolveUserWithCookie } from "~/lib/http";
import { claimsUserId, decodeJwt } from "~/lib/jwt";

/** What the media views need of a signed-in requester. */
export interface Viewer {
  id: number;
  transcodeVideos: boolean;
}

export type Claim = { uid: number; via: "bearer" | "cookie" };

export type Requester =
  /** Fully resolved: a viewer or anonymous (null). */
  | { kind: "resolved"; viewer: Viewer | null }
  /** A valid access token for user `uid`, not yet checked against api_user. */
  | ({ kind: "claimed" } & Claim);

function tokenUid(token: string): number | null {
  const claims = decodeJwt(token, "access");
  return typeof claims === "string" ? null : claimsUserId(claims);
}

/** The viewer by the shared resolver (one user query; throws its 401s). */
export async function resolveViewer(request: Request): Promise<Viewer | null> {
  const u = await resolveUserWithCookie(request);
  return u ? { id: u.id, transcodeVideos: u.transcodeVideos } : null;
}

/** A requester made definite: a claim is checked by the shared resolver. */
export const definite = (request: Request, r: Requester): Promise<Viewer | null> | Viewer | null =>
  r.kind === "resolved" ? r.viewer : resolveViewer(request);

/** The requester; throws the shared resolver's ApiErrors (401) like cookie-optional. */
export async function requester(request: Request): Promise<Requester> {
  const auth = request.headers.get("authorization");
  if (auth !== null) {
    const pieces = auth.split(/\s+/).filter(Boolean);
    if (pieces.length === 2 && pieces[0]!.toLowerCase() === "bearer") {
      const uid = tokenUid(pieces[1]!);
      if (uid !== null) return { kind: "claimed", uid, via: "bearer" };
    }
    return { kind: "resolved", viewer: await resolveViewer(request) };
  }
  const cookie = cookieValue(request, "jwt");
  if (!cookie) return { kind: "resolved", viewer: null };
  const uid = tokenUid(cookie);
  // An unusable cookie is anonymous (the shared resolver swallows its 401).
  return uid === null ? { kind: "resolved", viewer: null } : { kind: "claimed", uid, via: "cookie" };
}

/**
 * Settle a claim with the user row the lookup returned (undefined = no
 * such user). trusted = the lookup's grants were computed for this viewer.
 * A missing or inactive user: a bearer token gets the shared resolver's
 * 401, a cookie counts as anonymous.
 */
export async function settleClaim(
  request: Request,
  claim: Claim,
  me: { is_active: boolean | null; transcode_videos: boolean | null } | undefined,
): Promise<{ viewer: Viewer | null; trusted: boolean }> {
  if (me?.is_active === true) return { viewer: { id: claim.uid, transcodeVideos: me.transcode_videos === true }, trusted: true };
  if (claim.via === "cookie") return { viewer: null, trusted: false };
  return { viewer: await resolveViewer(request), trusted: false };
}
