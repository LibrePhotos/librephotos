import { ApiError, endpoints } from "@librephotos/api-client/core";
import {
  claimOutboxEntry,
  completeOutboxEntry,
  enqueueOutboxEntry,
  META_FAVORITE_MIN_RATING,
  outboxCounts,
  outboxPayload,
  refreshFavorites,
  rejectOutboxEntry,
  requeueOutboxEntry,
  resetInflightOutbox,
  retryOutboxEntry,
  retryStuckOutbox,
  setMeta,
  type OutboxCounts,
} from "@librephotos/local-db";
import { z } from "zod";
import { db } from "../db/database";
import { createLiveStore } from "../db/live";
import { inTauri } from "../ipc";
import { ContractError, errorMessage, isTransient, serverCall } from "../server/errors";
import { client, onSessionChange, signedInUser } from "../server/session";

export const EDIT_KIND = "desktop_photo_edit";
const RETRY_EVERY_MS = 30_000;

const EditPayload = z.object({
  md5: z.string().regex(/^[0-9a-f]{32}$/),
  userId: z.number().int(),
  field: z.enum(["rating", "caption", "keywords", "takenAt"]),
  value: z.union([z.number(), z.string(), z.array(z.string())]),
});
export type EditPayload = z.infer<typeof EditPayload>;
export type ServerEdit = { rating?: number; caption?: string; keywords?: string[]; takenAt?: string };

export async function queueServerEdit(md5: string, userId: number, edit: ServerEdit): Promise<number> {
  let queued = 0;
  for (const field of ["rating", "caption", "keywords", "takenAt"] as const) {
    const value = edit[field];
    if (value === undefined || (field === "takenAt" && value === "")) continue;
    const payload = EditPayload.parse({ md5, userId, field, value });
    await enqueueOutboxEntry(db, EDIT_KIND, payload, { key: `${md5}${userId}:${field}` });
    queued++;
  }
  if (queued > 0) wakeEditSync();
  return queued;
}

function permanent(error: unknown): boolean {
  if (error instanceof ContractError) return true;
  return error instanceof ApiError && !isTransient(error);
}

async function sendKeywords(hash: string, wanted: string[]): Promise<void> {
  const current = await serverCall(() => endpoints.fetchPhotoTags(client, hash));
  const want = new Map(wanted.map(name => [name.trim().toLowerCase(), name.trim()]));
  const have = new Map(current.map(tag => [tag.name.trim().toLowerCase(), tag]));
  for (const [key, tag] of have) {
    if (!want.has(key)) await serverCall(() => endpoints.removePhotosFromTag(client, tag.id, [hash]));
  }
  for (const [key, name] of want) {
    if (have.has(key) || name === "") continue;
    const tag = await serverCall(() => endpoints.createTag(client, name));
    await serverCall(() => endpoints.addPhotosToTag(client, tag.id, [hash]));
  }
}

export async function sendEdit(payload: EditPayload): Promise<"sent" | "not-on-server"> {
  const { md5, userId, field, value } = payload;
  const exists = await serverCall(() => endpoints.uploadExists(client, md5, userId));
  if (!exists.exists) return "not-on-server";
  const hash = `${md5}${userId}`;
  if (field === "rating" && typeof value === "number") {
    await serverCall(() => endpoints.setPhotoRating(client, hash, value));
  } else if (field === "caption" && typeof value === "string") {
    await serverCall(() => endpoints.savePhotoCaption(client, hash, value));
  } else if (field === "takenAt" && typeof value === "string") {
    await serverCall(() => endpoints.setPhotoTimestamp(client, hash, value));
  } else if (field === "keywords" && Array.isArray(value)) {
    await sendKeywords(hash, value);
  } else {
    throw new UnsendableEdit(`a ${field} edit with a ${typeof value} value`);
  }
  return "sent";
}

class UnsendableEdit extends Error {}

let running = false;
let again = false;
const listeners = new Set<() => void>();
export type SyncReport = { sent: number; skipped: number; lastError: string | null };
const report: SyncReport = { sent: 0, skipped: 0, lastError: null };

export function editSyncReport(): SyncReport {
  return { ...report };
}

function notify(): void {
  for (const l of listeners) l();
}

export function onEditSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function drain(): Promise<void> {
  if (!inTauri) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      for (;;) {
        const userId = signedInUser();
        if (userId === null) break;
        const entry = await claimOutboxEntry(db);
        if (!entry) break;
        if (entry.kind !== EDIT_KIND) {
          await requeueOutboxEntry(db, entry.id);
          break;
        }
        const parsed = EditPayload.safeParse(outboxPayload(entry));
        if (!parsed.success) {
          await rejectOutboxEntry(db, entry.id, "an entry this app cannot read");
          continue;
        }
        if (parsed.data.userId !== userId) {
          await requeueOutboxEntry(db, entry.id);
          break;
        }
        try {
          const outcome = await sendEdit(parsed.data);
          await completeOutboxEntry(db, entry.id);
          if (outcome === "sent") report.sent++;
          else report.skipped++;
          report.lastError = null;
        } catch (error) {
          report.lastError = errorMessage(error);
          if (permanent(error) || error instanceof UnsendableEdit) {
            await rejectOutboxEntry(db, entry.id, errorMessage(error));
            continue;
          }
          await retryOutboxEntry(db, entry.id, errorMessage(error));
          break;
        }
      }
    } while (again);
  } finally {
    running = false;
    notify();
  }
}

export function wakeEditSync(): void {
  void drain().catch((e: unknown) => console.warn("[edits] sync:", e));
}

export async function retryRejectedEdits(): Promise<number> {
  const n = await retryStuckOutbox(db);
  wakeEditSync();
  return n;
}

async function readFavoriteThreshold(): Promise<void> {
  const userId = signedInUser();
  if (userId === null) return;
  const user = await serverCall(() => endpoints.fetchUserSelfDetails(client, userId));
  await setMeta(db, META_FAVORITE_MIN_RATING, String(user.favorite_min_rating));
  await refreshFavorites(db);
}

let started = false;

export function startEditSync(): void {
  if (started || !inTauri) return;
  started = true;
  void resetInflightOutbox(db)
    .catch(() => 0)
    .then(() => wakeEditSync());
  onSessionChange(() => {
    wakeEditSync();
    void readFavoriteThreshold().catch(() => undefined);
  });
  void readFavoriteThreshold().catch(() => undefined);
  window.setInterval(wakeEditSync, RETRY_EVERY_MS);
  window.addEventListener("online", wakeEditSync);
}

const countsStore = createLiveStore<OutboxCounts>({ pending: 0, inflight: 0, failed: 0, rejected: 0 });

export function useEditSyncCounts(): OutboxCounts {
  return countsStore.use("edit-outbox", ["outbox"], () =>
    inTauri ? outboxCounts(db, [EDIT_KIND]) : Promise.resolve({ pending: 0, inflight: 0, failed: 0, rejected: 0 }),
  )[0];
}

