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
