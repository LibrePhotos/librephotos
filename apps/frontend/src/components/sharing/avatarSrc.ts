import { serverAddress } from "../../api_client/apiClient";

/**
 * A user's avatar, or the placeholder. The backend sends avatar_url relative to
 * the server ("/protected_media/..."), so it is prefixed like the menus do, or
 * it breaks on a deployment under a PUBLIC_URL subpath. Only avatar_url is read:
 * non-admins get the public user rows, which have no `avatar` field.
 */
export function avatarSrc(user?: { avatar_url?: string | null } | null): string {
  return user?.avatar_url ? `${serverAddress}${user.avatar_url}` : "/unknown_user.jpg";
}
