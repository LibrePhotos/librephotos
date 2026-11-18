export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 2 : value < 100 ? 1 : 0)} ${units[unit] ?? "TB"}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });

/** `takenAt` is local time without an offset ("2024-05-01T14:03:00"), which `Date` reads as local. */
export function formatTaken(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date);
}

export function formatModified(ms: number): string {
  return dateFormat.format(new Date(ms));
}

export function formatMegapixels(w: number, h: number): string {
  return `${((w * h) / 1_000_000).toFixed(1)} MP`;
}

export function formatCoordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(5)}° ${value >= 0 ? positive : negative}`;
}

export function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return cut > 0 ? path.slice(0, cut) : path;
}

/** "Canon" + "Canon EOS R6" -> "Canon EOS R6"; "NIKON CORPORATION" + "NIKON Z 6" -> "NIKON Z 6". */
export function cameraName(make: string | null, model: string | null): string | null {
  if (!make) return model;
  if (!model) return make;
  const firstWord = make.split(/\s+/)[0] ?? make;
  return model.toLowerCase().startsWith(firstWord.toLowerCase()) ? model : `${make} ${model}`;
}

const mediumDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const weekdayTime = new Intl.DateTimeFormat(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" });
const shortDate = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

function parseLocal(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The info panel's date: "Oct 18, 2026" over "Sunday, 8:05 PM", as the web lightbox shows it. */
export function formatDateParts(value: string | number): { date: string; detail: string } {
  const date = typeof value === "number" ? new Date(value) : parseLocal(value);
  if (!date) return { date: String(value), detail: "" };
  return { date: mediumDate.format(date), detail: weekdayTime.format(date) };
}

/** The title bar's date: "Sun, Oct 18, 2026". */
export function formatShortDate(iso: string): string {
  const date = parseLocal(iso);
  return date ? shortDate.format(date) : iso;
}

/** "38.71040, -9.13639": signed decimal degrees, the form maps and the web app take. */
export function formatLatLon(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/** The last part of a folder path ("raw" for C:\photos\raw). */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return cut >= 0 ? trimmed.slice(cut + 1) || trimmed : trimmed;
}

/** A path split after each separator, so it wraps at folder boundaries (render with <wbr>). */
export function pathParts(path: string): string[] {
  return path.split(/(?<=[\\/])/);
}
