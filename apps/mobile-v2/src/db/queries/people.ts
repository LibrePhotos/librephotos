/**
 * People album grid over the mirror. Only `person` rows are mirrored (faces are
 * online-only, doc 02); tapping a person fetches their photos via api-client.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "../types";

export type PersonRow = {
  id: number;
  name: string | null;
  kind: string | null;
  face_count: number | null;
  cover_photo_hash: string | null;
};

/** People with at least one face, most-photographed first. */
export function people(db: AppDatabase): PersonRow[] {
  return db.all(
    sql`SELECT id, name, kind, face_count, cover_photo_hash
        FROM person
        WHERE COALESCE(face_count, 0) > 0
        ORDER BY face_count DESC, name ASC`
  ) as PersonRow[];
}
