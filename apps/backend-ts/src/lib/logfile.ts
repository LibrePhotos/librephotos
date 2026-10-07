// BASE_LOGS/ownphotos.log, the file the admin log viewer and download read
// (librephotos.logging_bootstrap; port of lp_server::logfile): console output
// is copied there in Django's line layout, rotated at 200 MB with 10 backups
// like Python's RotatingFileHandler.
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { format } from "node:util";
import { config } from "./config";

export const LOG_FILENAME = "ownphotos.log";
const MAX_BYTES = 200 * 1024 * 1024;
const BACKUPS = 10;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
/** asctime: local "YYYY-MM-DD HH:MM:SS,mmm". */
function asctime(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())},${pad(d.getMilliseconds(), 3)}`;
}

let installed = false;

/** Tee console.log/info/warn/error into BASE_LOGS/ownphotos.log (idempotent). */
export function installLogFile(dir = config.baseLogs) {
  if (installed) return;
  installed = true;
  const file = path.join(dir, LOG_FILENAME);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error(`not logging to ${file}:`, e);
    return;
  }
  let size = existsSync(file) ? statSync(file).size : 0;
  const rotate = () => {
    try {
      for (let n = BACKUPS - 1; n >= 1; n--) if (existsSync(`${file}.${n}`)) renameSync(`${file}.${n}`, `${file}.${n + 1}`);
      renameSync(file, `${file}.1`);
      size = 0;
    } catch {
      // Another process holding the file open (Windows): keep growing it.
    }
  };
  const write = (level: string, args: unknown[]) => {
    const line = `${asctime()} : server.ts : librephotos-ts : 0 : ${level} : ${format(...args)}\n`;
    const bytes = Buffer.byteLength(line);
    if (size > 0 && size + bytes > MAX_BYTES) rotate();
    try {
      appendFileSync(file, line);
      size += bytes;
    } catch {
      // Logging must never break a request.
    }
  };
  for (const [method, level] of [
    ["log", "INFO"],
    ["info", "INFO"],
    ["warn", "WARNING"],
    ["error", "ERROR"],
  ] as const) {
    const orig = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      orig(...args);
      write(level, args);
    };
  }
}
