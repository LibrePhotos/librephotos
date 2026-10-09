import type { ManageUser, User } from "@librephotos/api-client";

// The user schemas are shared with the mobile app and live in
// packages/api-client; this module re-exports them under their old names.
//
// `ListUser` is the row shape of the GET /api/user/ list (and of a /user/<id>/
// retrieve of someone else's record). Since the #1861 authorization fix the
// backend only serializes the full UserSerializer for admins and for a user
// viewing their own record; every other reader receives the public-safe
// PublicUserSerializer (id, avatar_url, username, first/last name,
// public_photo_count, public_photo_samples, public_sharing). Validating those
// rows against the full `User` schema spammed non-admins with "Required at
// results.N.<field>" popups (issue #1888), so there the private/admin-only
// fields are optional while the public-safe fields stay required.
export {
  ListUser,
  ListUserList,
  ManageUser,
  PublicPhotoSample,
  PublicSharingDefaults,
  SimpleUser,
  User,
  UserList,
} from "@librephotos/api-client";

/** A PATCH to /manage/user/<id>/: the id, plus only the fields that change. */
export type ManageUserPatch = Partial<ManageUser> & Pick<ManageUser, "id">;

export type UserState = {
  userSelfDetails: User;
  error: Error | string | null | undefined;
};
