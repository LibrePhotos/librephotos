// timezonefinder's timezone_at(lng, lat) for the gps_timezonefinder datetime
// rule (Rust: tzf-rs). @photostructure/tz-lookup is a ~90 KB table that can
// differ from timezonefinder within a few km of a border.
export async function tzNameAt(lat: number, lon: number): Promise<string | undefined> {
  try {
    const { default: lookup } = await import("@photostructure/tz-lookup");
    return lookup(lat, lon);
  } catch {
    return undefined;
  }
}
