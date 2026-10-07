// /api/timezones/, /api/predefinedrules/, /api/predefinedburstrules/,
// /api/defaultrules/, /api/defaultburstrules/: Django returns
// Response(json.dumps(...)), a JSON-encoded string the frontend JSON.parses.
// The payloads are the exact strings Django builds. Port of
// lp_api::users_settings::static_data.
import { DEFAULT_BURST_RULES, DEFAULT_RULES, PREDEFINED_BURST_RULES, PREDEFINED_RULES, TIMEZONES } from "./static_payloads";

const PAYLOADS = {
  timezones: TIMEZONES,
  predefinedrules: PREDEFINED_RULES,
  predefinedburstrules: PREDEFINED_BURST_RULES,
  defaultrules: DEFAULT_RULES,
  defaultburstrules: DEFAULT_BURST_RULES,
};

const bodies = new Map<string, string>();

/** The response for one of the endpoints: the payload as a JSON string, built once. */
export function staticJsonString(name: keyof typeof PAYLOADS): Response {
  let b = bodies.get(name);
  if (b === undefined) {
    b = JSON.stringify(PAYLOADS[name]);
    bodies.set(name, b);
  }
  return new Response(b, { headers: { "Content-Type": "application/json" } });
}
