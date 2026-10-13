import { DateTime } from "luxon";
import { parsePhotoTimestamp } from "../../util/dateUtils";

/** The photo's date as the page's title ("Saturday, August 17, 2024") and its time; null without a usable date. */
export function photoDate(exifTimestamp: string | null | undefined): { date: string; time: string } | null {
  if (!exifTimestamp) return null;
  const taken = parsePhotoTimestamp(exifTimestamp);
  if (!taken.isValid) return null;
  return { date: taken.toLocaleString(DateTime.DATE_HUGE), time: taken.toLocaleString(DateTime.TIME_SIMPLE) };
}

/** The file name of a path from either a POSIX or a Windows backend. */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** The folder a file is in, with forward slashes, as the folder pages take it. */
export function folderOf(path: string): string {
  return path.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
}

/** Width × height in megapixels, one decimal ("26.0" reads as 26); null when either is missing. */
export function megapixels(width: number | null, height: number | null): number | null {
  if (!width || !height) return null;
  return Math.round((width * height) / 100_000) / 10;
}
