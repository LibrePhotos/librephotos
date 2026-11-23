import {
  DEFAULT_FAVORITE_MIN_RATING,
  getMetaNumber,
  localAssetByUri,
  localAssetEdits,
  META_FAVORITE_MIN_RATING,
  setLocalAssetEdits,
  upsertLooseFile,
  type EditField,
  type LocalAssetEdits,
} from "@librephotos/local-db";
import { db } from "../db/database";
import { md5File, statPaths } from "../db/seams";
import { inTauri, writeMetadata, type FileEntry, type ImageInfo } from "../ipc";
import { forgetInfo } from "../lib/infoCache";
import { signedInUser } from "../server/session";
import { queueServerEdit } from "./serverSync";
import { loadSettings, type MetadataTarget } from "./settings";

export type PhotoEdit = { rating?: number; caption?: string; keywords?: string[]; takenAt?: string };

export type SaveResult = {
  modifiedMs: number;
  savedTo: MetadataTarget;
  sidecar: string | null;
  serverQueued: boolean;
};

export type Editable = {
  rating: number;
  favorite: boolean;
  favoriteMin: number;
  caption: string;
  keywords: string[];
  takenAt: string | null;
  appOnly: EditField[];
  sidecar: string | null;
  writableInFile: boolean;
};

export async function favoriteMinRating(): Promise<number> {
  if (!inTauri) return DEFAULT_FAVORITE_MIN_RATING;
  return (await getMetaNumber(db, META_FAVORITE_MIN_RATING)) ?? DEFAULT_FAVORITE_MIN_RATING;
}

export function favoriteEdit(current: Editable, favorite: boolean): PhotoEdit {
  if (favorite) return { rating: Math.max(current.rating, current.favoriteMin) };
  return { rating: 0 };
}

export function editableOf(info: ImageInfo, local: LocalAssetEdits | null, favoriteMin: number): Editable {
  const appOnly = local?.appOnly ?? [];
  const has = (f: EditField) => local !== null && appOnly.includes(f);
  const rating = Math.max(0, Math.min(5, has("rating") ? (local?.rating ?? 0) : (info.rating ?? 0)));
  return {
    rating,
    favorite: rating >= favoriteMin,
    favoriteMin,
    caption: has("caption") ? (local?.caption ?? "") : (info.caption ?? ""),
    keywords: has("keywords") ? (local?.keywords ?? []) : info.keywords,
    takenAt: has("takenAt") ? (local?.takenAt ?? info.takenAt) : info.takenAt,
    appOnly,
    sidecar: info.sidecar,
    writableInFile: info.writableInFile,
  };
}

export function applyEdit(value: Editable, edit: PhotoEdit): Editable {
  const rating = edit.rating ?? value.rating;
  return {
    ...value,
    rating,
    favorite: rating >= value.favoriteMin,
    caption: edit.caption ?? value.caption,
    keywords: edit.keywords ?? value.keywords,
    takenAt: edit.takenAt ?? value.takenAt,
  };
}

export async function localEditsOf(path: string): Promise<LocalAssetEdits | null> {
  return inTauri ? localAssetEdits(db, path) : null;
}

async function ensureRow(path: string): Promise<{ hash: string | null }> {
  const row = await localAssetByUri(db, path);
  if (row) return { hash: row.hash };
  const [entry] = await statPaths([path]);
  if (!entry) throw new Error(`${path} is not a picture or video`);
  await upsertLooseFile(db, entry);
  return { hash: null };
}

async function serverMd5(path: string, hash: string | null, userId: number): Promise<string | null> {
  if (hash && hash.endsWith(String(userId)) && hash.length === 32 + String(userId).length) return hash.slice(0, 32);
  try {
    return await md5File(path);
  } catch {
    return null;
  }
}

export async function savePhotoEdit(file: FileEntry, edit: PhotoEdit): Promise<SaveResult> {
  const { metadataTarget } = await loadSettings();
  const row = inTauri ? await ensureRow(file.path) : { hash: null };
  const userId = inTauri ? signedInUser() : null;
  const md5 = userId === null ? null : await serverMd5(file.path, row.hash, userId);
  let modifiedMs = file.modifiedMs;
  let sidecar: string | null = null;
  if (metadataTarget !== "app") {
    const outcome = await writeMetadata(file.path, edit, metadataTarget);
    modifiedMs = outcome.modifiedMs;
    sidecar = outcome.sidecar;
  }
  if (inTauri) await setLocalAssetEdits(db, file.path, edit, { appOnly: metadataTarget === "app" });
  forgetInfo(file.path);
  const serverQueued = userId !== null && md5 !== null && (await queueServerEdit(md5, userId, edit)) > 0;
  return { modifiedMs, savedTo: metadataTarget, sidecar, serverQueued };
}
