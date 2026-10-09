/**
 * True for a public album whose owner keeps the capture dates private (the
 * default). The server then sends every photo in one group without a date,
 * which a date view shows as a "Without Timestamp" day: wrong, the photos do
 * have dates. Such an album is shown as a flat grid instead.
 */
export function isUndatedShare(groups: ReadonlyArray<{ date?: string | null }>): boolean {
  return groups.length === 1 && !groups[0].date;
}
