// UserSerializer, PublicUserSerializer, ManageUserSerializer and
// SignupUserSerializer output in their Meta.fields order. Port of
// lp_api::users_settings::serialize.
import type { UserRow } from "./db";

/** obj.avatar.url (MEDIA_URL + filepath_to_uri), or null without an avatar. */
export function avatarUrl(avatar: string | null): string | null {
  if (!avatar) return null;
  // urllib.parse.quote(path, safe="/~!*()'"): encodeURIComponent keeps the same set minus "/".
  return "/media/" + encodeURIComponent(avatar.replace(/\\/g, "/")).replace(/%2F/g, "/");
}

/** request.build_absolute_uri("") origin, as DRF's ImageField uses it. */
export function requestOrigin(req: Request): string {
  const host = req.headers.get("host") ?? "localhost";
  const scheme = req.headers.get("x-forwarded-proto") === "https" ? "https" : "http";
  return `${scheme}://${host}`;
}

/** UserSerializer: the full profile (admins and the user themself). */
export function fullUser(u: UserRow, origin: string) {
  const url = avatarUrl(u.avatar);
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    scan_directory: u.scan_directory,
    confidence: u.confidence,
    confidence_person: u.confidence_person,
    transcode_videos: u.transcode_videos,
    semantic_search_topk: u.semantic_search_topk,
    first_name: u.first_name,
    public_photo_samples: u.public_photo_samples,
    last_name: u.last_name,
    public_photo_count: u.public_photo_count,
    date_joined: u.date_joined,
    avatar: url === null ? null : origin + url,
    is_superuser: u.is_superuser,
    photo_count: u.photo_count,
    nextcloud_server_address: u.nextcloud_server_address,
    nextcloud_username: u.nextcloud_username,
    nextcloud_scan_directory: u.nextcloud_scan_directory,
    avatar_url: url,
    favorite_min_rating: u.favorite_min_rating,
    image_scale: u.image_scale,
    text_alignment: u.text_alignment,
    header_size: u.header_size,
    save_metadata_to_disk: u.save_metadata_to_disk,
    save_face_tags_to_disk: u.save_face_tags_to_disk,
    datetime_rules: u.datetime_rules,
    burst_detection_rules: u.burst_detection_rules,
    llm_settings: u.llm_settings,
    default_timezone: u.default_timezone,
    public_sharing: u.public_sharing,
    public_sharing_defaults: u.public_sharing_defaults,
    min_cluster_size: u.min_cluster_size,
    confidence_unknown_face: u.confidence_unknown_face,
    min_samples: u.min_samples,
    cluster_selection_epsilon: u.cluster_selection_epsilon,
    skip_raw_files: u.skip_raw_files,
    stack_raw_jpeg: u.stack_raw_jpeg,
    slideshow_interval: u.slideshow_interval,
    duplicate_sensitivity: u.duplicate_sensitivity,
    duplicate_clear_existing: u.duplicate_clear_existing,
  };
}

/** PublicUserSerializer: everyone else. */
export function publicUser(u: UserRow) {
  return {
    id: u.id,
    avatar_url: avatarUrl(u.avatar),
    username: u.username,
    first_name: u.first_name,
    last_name: u.last_name,
    public_photo_count: u.public_photo_count,
    public_photo_samples: u.public_photo_samples,
    public_sharing: u.public_sharing,
  };
}

/** ManageUserSerializer */
export function manageUser(u: UserRow) {
  return {
    username: u.username,
    scan_directory: u.scan_directory,
    skip_raw_files: u.skip_raw_files,
    stack_raw_jpeg: u.stack_raw_jpeg,
    confidence: u.confidence,
    semantic_search_topk: u.semantic_search_topk,
    last_login: u.last_login,
    date_joined: u.date_joined,
    photo_count: u.photo_count,
    id: u.id,
    favorite_min_rating: u.favorite_min_rating,
    image_scale: u.image_scale,
    save_metadata_to_disk: u.save_metadata_to_disk,
    email: u.email,
    first_name: u.first_name,
    last_name: u.last_name,
  };
}

/** SignupUserSerializer (password and is_superuser are write-only). */
export const signupUserOut = (u: UserRow) => ({
  username: u.username,
  email: u.email,
  first_name: u.first_name,
  last_name: u.last_name,
});
