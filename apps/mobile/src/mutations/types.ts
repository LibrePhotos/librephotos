/**
 * Offline-mutation outbox kinds + zod-validated payloads (doc 03 §6).
 *
 * Every offline mutation writes ONE `outbox` row whose `payload` column is a
 * JSON blob validated against the matching schema here. The kinds map 1:1 to the
 * api-client mutation endpoints the replay engine drains them through. Payloads
 * carry BOTH identifiers a photo needs — the UUID `photoId` (mirror membership,
 * album add) and the `imageHash` (every `/photosedit/*` endpoint + album remove)
 * — because the backend is asymmetric about which it accepts (Phase 4 handoff).
 */
import { z } from "zod";

export const FavoritePayload = z.object({
  imageHashes: z.array(z.string()).min(1),
  favorite: z.boolean(),
});
export const HidePayload = z.object({
  imageHashes: z.array(z.string()).min(1),
  hidden: z.boolean(),
});
export const TrashPayload = z.object({
  imageHashes: z.array(z.string()).min(1),
  deleted: z.boolean(),
});
export const RatingPayload = z.object({
  imageHash: z.string(),
  rating: z.number().int().min(0).max(5),
});
export const CaptionPayload = z.object({
  imageHash: z.string(),
  caption: z.string(),
});
export const AlbumAddPayload = z.object({
  albumId: z.number().int(),
  title: z.string(),
  photoIds: z.array(z.string()).min(1),
  imageHashes: z.array(z.string()),
});
export const AlbumRemovePayload = z.object({
  albumId: z.number().int(),
  title: z.string(),
  photoIds: z.array(z.string()).min(1),
  imageHashes: z.array(z.string()).min(1),
});
export const AlbumCreatePayload = z.object({
  /** Negative client-temp id, swapped for the server id on replay. */
  tempId: z.number().int().negative(),
  title: z.string().min(1),
  photoIds: z.array(z.string()),
});
export const AlbumRenamePayload = z.object({
  albumId: z.number().int(),
  title: z.string().min(1),
});
export const PersonRenamePayload = z.object({
  personId: z.number().int(),
  name: z.string().min(1),
});

/** kind → payload schema. The single source of truth for validation. */
export const OUTBOX_SCHEMAS = {
  favorite: FavoritePayload,
  hide: HidePayload,
  trash: TrashPayload,
  rating: RatingPayload,
  caption: CaptionPayload,
  album_add: AlbumAddPayload,
  album_remove: AlbumRemovePayload,
  album_create: AlbumCreatePayload,
  album_rename: AlbumRenamePayload,
  person_rename: PersonRenamePayload,
} as const;

export type OutboxKind = keyof typeof OUTBOX_SCHEMAS;

export type OutboxPayload<K extends OutboxKind> = z.infer<(typeof OUTBOX_SCHEMAS)[K]>;

export type OutboxState = "pending" | "inflight" | "failed";

export type OutboxRow = {
  id: number;
  created_at: number;
  kind: OutboxKind;
  payload: string | null;
  state: OutboxState;
  attempts: number;
  last_error: string | null;
  inflight_at: number | null;
  next_attempt_at: number | null;
};

/** All outbox kinds that are offline-capable (i.e. produced by this module). */
export const OFFLINE_KINDS = Object.keys(OUTBOX_SCHEMAS) as OutboxKind[];
