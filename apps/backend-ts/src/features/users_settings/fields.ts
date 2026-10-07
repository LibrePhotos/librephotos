// DRF field validation for the user serializers (rest_framework.fields): the
// same accepted inputs, coercions and error messages. Port of
// lp_api::users_settings::fields.
import { ApiError, type FieldError } from "~/lib/errors";
import { parseClientDatetime } from "~/lib/time";
import { TIMEZONES } from "./static_payloads";

export type Kind =
  | { t: "char"; max: number; min: number; allowBlank: boolean }
  | { t: "username" }
  | { t: "email" }
  | { t: "int" }
  | { t: "float" }
  | { t: "bool" }
  | { t: "choice"; choices: readonly string[] }
  | { t: "timezone" }
  | { t: "json" }
  | { t: "datetime"; allowNull: boolean };

/** A validated value: str/number/bool, `{json}` for JSON fields, `{dt}` for a datetime only validated. */
export type Parsed = string | number | boolean | { json: unknown } | { dt: true } | null;

export const charK = (max: number, min = 0, allowBlank = true): Kind => ({ t: "char", max, min, allowBlank });
export const K = {
  username: { t: "username" } as Kind,
  email: { t: "email" } as Kind,
  int: { t: "int" } as Kind,
  float: { t: "float" } as Kind,
  bool: { t: "bool" } as Kind,
  timezone: { t: "timezone" } as Kind,
  json: { t: "json" } as Kind,
  choice: (choices: readonly string[]): Kind => ({ t: "choice", choices }),
  datetime: (allowNull: boolean): Kind => ({ t: "datetime", allowNull }),
};

export const SAVE_METADATA = ["OFF", "MEDIA_FILE", "SIDECAR_FILE"];
export const TEXT_ALIGNMENT = ["left", "right"];
export const HEADER_SIZE = ["large", "normal", "small"];
export const DUPLICATE_SENSITIVITY = ["strict", "normal", "loose"];

let tzSet: Set<string> | null = null;
/** pytz.all_timezones (the default_timezone choices). */
const timezones = () => (tzSet ??= new Set(JSON.parse(TIMEZONES) as string[]));

/** Python str() of a JSON scalar. */
export function pyStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === true) return "True";
  if (v === false) return "False";
  if (v === null || v === undefined) return "None";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

const USERNAME_RE = /^[\p{L}\p{N}_.@+-]+$/u;
export const USERNAME_INVALID =
  "Enter a valid username. This value may contain only letters, numbers, and @/./+/-/_ characters.";

const EMAIL_USER = /^[-!#$%&'*+/=?^_`{}|~0-9A-Z]+(\.[-!#$%&'*+/=?^_`{}|~0-9A-Z]+)*$/i;
const EMAIL_QUOTED = /^"([\x01-\x08\x0b\x0c\x0e-\x1f!#-\[\]-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*"$/i;
const EMAIL_DOMAIN = /^((?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+)(?:[A-Z0-9-]{2,63})$/i;

/** Django's EmailValidator (unquoted/quoted local parts; domains, localhost, IP literals). */
export function isValidEmail(value: string): boolean {
  if (!value || [...value].length > 320) return false;
  const at = value.lastIndexOf("@");
  if (at < 0) return false;
  const user = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!EMAIL_USER.test(user) && !EMAIL_QUOTED.test(user)) return false;
  if (domain === "localhost") return true;
  if (EMAIL_DOMAIN.test(domain) && !domain.endsWith("-")) return true;
  // Django retries with the IDNA-encoded domain; non-ASCII labels pass when shaped like a hostname.
  if (/[^\x00-\x7f]/.test(domain)) {
    const ascii = domain.replace(/[^\x00-\x7f]/g, "x");
    if (EMAIL_DOMAIN.test(ascii) && !ascii.endsWith("-")) return true;
  }
  const lit = /^\[(.+)\]$/.exec(domain);
  if (lit) {
    const inner = lit[1].startsWith("IPv6:") ? lit[1].slice(5) : lit[1];
    return isIp(inner);
  }
  return false;
}

function isIp(s: string): boolean {
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s)) return s.split(".").every((o) => Number(o) <= 255 && !/^0\d/.test(o));
  try {
    return new URL(`http://[${s}]/`).hostname.length > 0 && s.includes(":");
  } catch {
    return false;
  }
}

type R = { ok: Parsed } | { err: string[] };
const one = (m: string): R => ({ err: [m] });

/** DRF CharField run_validation. */
function parseChar(v: unknown, max: number, min: number, allowBlank: boolean): R {
  if (typeof v === "string" && v.trim() === "") return allowBlank ? { ok: "" } : one("This field may not be blank.");
  if (v === null) return one("This field may not be null.");
  if (typeof v !== "string" && typeof v !== "number") return one("Not a valid string.");
  const s = pyStr(v).trim();
  const errs: string[] = [];
  const len = [...s].length;
  if (len > max) errs.push(`Ensure this field has no more than ${max} characters.`);
  if (len < min) errs.push(`Ensure this field has at least ${min} characters.`);
  if (s.includes("\0")) errs.push("Null characters are not allowed.");
  return errs.length ? { err: errs } : { ok: s };
}

const TRUE_VALUES = new Set(["t", "T", "y", "Y", "yes", "Yes", "YES", "true", "True", "TRUE", "on", "On", "ON", "1"]);
const FALSE_VALUES = new Set(["f", "F", "n", "N", "no", "No", "NO", "false", "False", "FALSE", "off", "Off", "OFF", "0"]);
const FLOAT_RE = /^[+-]?((\d(_?\d)*)(\.(\d(_?\d)*)?)?|\.\d(_?\d)*)([eE][+-]?\d(_?\d)*)?$|^[+-]?(inf|infinity|nan)$/i;
const DATETIME_FORMAT =
  "Datetime has wrong format. Use one of these formats instead: YYYY-MM-DDThh:mm[:ss[.uuuuuu]][+HH:MM|-HH:MM|Z].";

/** Validate one input value like the DRF field would; messages in DRF order. */
export function parse(kind: Kind, v: unknown): R {
  switch (kind.t) {
    case "char":
      return parseChar(v, kind.max, kind.min, kind.allowBlank);
    case "username": {
      const r = parseChar(v, 150, 0, false);
      if ("err" in r) return r;
      return USERNAME_RE.test(r.ok as string) ? r : one(USERNAME_INVALID);
    }
    case "email": {
      const r = parseChar(v, 254, 0, true);
      if ("err" in r) return r;
      const s = r.ok as string;
      return s && !isValidEmail(s) ? one("Enter a valid email address.") : r;
    }
    case "int": {
      if (v === null) return one("This field may not be null.");
      if (typeof v === "string" && [...v].length > 1000) return one("String value too large.");
      if (typeof v !== "string" && typeof v !== "number") return one("A valid integer is required.");
      // IntegerField.re_decimal: "\.0*\s*$" is removed before int().
      const text = pyStr(v).replace(/\.0*\s*$/, "").trim();
      if (!/^[+-]?\d(_?\d)*$/.test(text)) return one("A valid integer is required.");
      const n = Number(text.replace(/_/g, ""));
      if (n > 2147483647) return one("Ensure this value is less than or equal to 2147483647.");
      if (n < -2147483648) return one("Ensure this value is greater than or equal to -2147483648.");
      return { ok: n };
    }
    case "float": {
      if (v === null) return one("This field may not be null.");
      if (typeof v === "boolean") return { ok: v ? 1 : 0 };
      if (typeof v === "number") return { ok: v };
      if (typeof v === "string") {
        if ([...v].length > 1000) return one("String value too large.");
        const t = v.trim();
        if (!FLOAT_RE.test(t)) return one("A valid number is required.");
        const lower = t.toLowerCase().replace(/^[+]/, "");
        if (lower.endsWith("nan")) return { ok: NaN };
        if (lower.includes("inf")) return { ok: lower.startsWith("-") ? -Infinity : Infinity };
        return { ok: Number(t.replace(/_/g, "")) };
      }
      return one("A valid number is required.");
    }
    case "bool": {
      if (v === true || v === 1 || (typeof v === "string" && TRUE_VALUES.has(v))) return { ok: true };
      if (v === false || v === 0 || (typeof v === "string" && FALSE_VALUES.has(v))) return { ok: false };
      return one(v === null ? "This field may not be null." : "Must be a valid boolean.");
    }
    case "choice":
    case "timezone": {
      if (v === null) return one("This field may not be null.");
      const s = pyStr(v);
      const ok = kind.t === "choice" ? kind.choices.includes(s) : timezones().has(s);
      return ok ? { ok: s } : one(`"${s}" is not a valid choice.`);
    }
    case "json":
      return v === null ? one("This field may not be null.") : { ok: { json: v } };
    case "datetime":
      if (v === null) return kind.allowNull ? { ok: null } : one("This field may not be null.");
      if (typeof v === "string" && parseClientDatetime(v) !== null) return { ok: { dt: true } };
      return one(DATETIME_FORMAT);
  }
}

/** Per-field errors in serializer field order (messages joined with a space). */
export class Errors {
  list: FieldError[] = [];
  add(field: string, messages: string[]) {
    this.list.push({ field, message: messages.join(" ") });
  }
  throwIfAny() {
    if (this.list.length) throw ApiError.fields(400, this.list);
  }
}
