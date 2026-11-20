/**
 * Hooks for test runs over CDP (`await (await window.__lpDev()).addLibraryRoot(path)`): the calls a
 * native dialog or a click would make, without them. Loaded on first use only.
 */
import { dbInfo } from "../db/executor";
import {
  addLibraryRoot,
  libraryFiles,
  librarySearch,
  removeLibraryRoot,
  serverConnect,
  serverSetBackup,
  serverSetPaused,
  serverState,
  serverUploadFile,
} from "./api";
import { backupStats } from "../server/backup";
import { libraryProgress, localAssetEdits, localAssetByUri, outboxCounts, outboxEntries } from "@librephotos/local-db";
import { db } from "../db/database";
import { imageInfo, type FileEntry } from "../ipc";
import { savePhotoEdit, type PhotoEdit } from "../edits/photoEdits";
import { EDIT_KIND, wakeEditSync } from "../edits/serverSync";
import { loadSettings, saveSettings } from "../edits/settings";
import { statPaths } from "../db/seams";

async function editFile(path: string, edit: PhotoEdit) {
  const [entry] = await statPaths([path]);
  if (!entry) throw new Error(`${path} is not a picture`);
  const file: FileEntry = { path, name: entry.name, size: entry.size, modifiedMs: entry.mtimeMs, kind: entry.kind };
  return savePhotoEdit(file, edit);
}

export const dev = {
  dbInfo,
  addLibraryRoot,
  removeLibraryRoot,
  libraryFiles,
  librarySearch,
  serverConnect,
  serverSetBackup,
  serverSetPaused,
  serverState,
  serverUploadFile,
  backupStats,
  progress: () => libraryProgress(db),
  imageInfo,
  editFile,
  localEdits: (path: string) => localAssetEdits(db, path),
  localRow: (path: string) => localAssetByUri(db, path),
  settings: loadSettings,
  saveSettings,
  outbox: async () => ({ counts: await outboxCounts(db, [EDIT_KIND]), entries: await outboxEntries(db, [EDIT_KIND]) }),
  wakeEditSync,
};
