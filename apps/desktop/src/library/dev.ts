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
import { libraryProgress } from "@librephotos/local-db";
import { db } from "../db/database";

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
};
