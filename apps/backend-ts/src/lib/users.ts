// api_user reads (port of lp_db::users).
import { eq, getTableColumns, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "./db";
import { drfTs } from "./time";

const { nextcloudAppPassword: _secret, ...plainColumns } = getTableColumns(schema.apiUser);
/**
 * Every api_user column except the encrypted nextcloud_app_password. The
 * datetimes come back as DRF strings ("...123456Z", microseconds kept;
 * Bun's driver would truncate them to milliseconds).
 */
export const userColumns = {
  ...plainColumns,
  lastLogin: sql<string | null>`${drfTs(sql`api_user.last_login`)}`.as("last_login"),
  dateJoined: sql<string>`${drfTs(sql`api_user.date_joined`)}`.as("date_joined"),
  lastModified: sql<string>`${drfTs(sql`api_user.last_modified`)}`.as("last_modified"),
};

export type User = Omit<typeof schema.apiUser.$inferSelect, "nextcloudAppPassword" | "lastLogin" | "dateJoined" | "lastModified"> & {
  lastLogin: string | null;
  dateJoined: string;
  lastModified: string;
};

export async function userById(id: number, tx: Db | Tx = db): Promise<User | undefined> {
  const r = await tx.select(userColumns).from(schema.apiUser).where(eq(schema.apiUser.id, id)).limit(1);
  return r[0];
}

/** Exact, case-sensitive username match (Django get_by_natural_key). */
export async function userByUsername(username: string, tx: Db | Tx = db): Promise<User | undefined> {
  const r = await tx.select(userColumns).from(schema.apiUser).where(eq(schema.apiUser.username, username)).limit(1);
  return r[0];
}

/** DRF IsAdminUser checks is_staff; the JWT is_admin claim is is_superuser. */
export const isAdmin = (u: User) => u.isStaff;

/** SimpleUserSerializer (zod SimpleUser). */
export const simpleUser = (u: Pick<User, "id" | "username" | "firstName" | "lastName">) => ({
  id: u.id,
  username: u.username,
  first_name: u.firstName,
  last_name: u.lastName,
});
