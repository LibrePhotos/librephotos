/**
 * A shutter speed as the backend stores it ("1/250", "0.3", "2.5", "30"; ExifTool's own
 * printing) with a unit where the bare number would read as a fraction: "2.5 s", "30 s".
 * "1/250" stays as cameras print it. A "0" an older backend stored for anything faster than
 * 1/2000 s says nothing, so it is left out.
 */
export function formatShutterSpeed(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "0") return null;
  return /^\d+(\.\d+)?$/.test(trimmed) ? `${trimmed} s` : trimmed;
}
