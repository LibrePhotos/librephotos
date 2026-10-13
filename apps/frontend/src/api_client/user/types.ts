import type { ManageUser } from "@librephotos/api-client";

/** A PATCH to /manage/user/<id>/: the id, plus only the fields that change. */
export type ManageUserPatch = Partial<ManageUser> & Pick<ManageUser, "id">;
