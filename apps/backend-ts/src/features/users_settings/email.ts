// Outgoing email: GET/POST /api/email-config/, POST /api/email-config/test/
// (api/views/email_config.py, api/models/email_config.py, api/mail.py). Port
// of lp_api::users_settings::email.
import { ApiError } from "~/lib/errors";
import { json, jsonBody } from "~/lib/http";
import { pyTruthy } from "~/lib/query";
import type { User } from "~/lib/users";
import { decryptStr, encryptStr } from "./crypto";
import { emailConfigRow, saveEmailConfig } from "./db";
import { sendMail as smtpSend } from "./smtp";
import { EMAIL_PRESETS } from "./static_payloads";

const presets = JSON.parse(EMAIL_PRESETS) as Record<string, Record<string, unknown>>;

/** settings.DEFAULT_FROM_EMAIL */
const defaultFromEmail = () => process.env.DEFAULT_FROM_EMAIL ?? "LibrePhotos <no-reply@localhost>";

/** EmailConfig with its secret decrypted. */
export interface EmailConfig {
  provider: string;
  from_email: string;
  host: string;
  port: number;
  use_tls: boolean;
  use_ssl: boolean;
  username: string;
  secret: string;
}

const DEFAULT: EmailConfig = { provider: "disabled", from_email: "", host: "", port: 587, use_tls: true, use_ssl: false, username: "", secret: "" };

const preset = (c: EmailConfig, key: string) => presets[c.provider]?.[key];
export const effectiveFromEmail = (c: EmailConfig) => c.from_email || defaultFromEmail();
const smtpHost = (c: EmailConfig) => c.host || (typeof preset(c, "host") === "string" ? (preset(c, "host") as string) : "");
const smtpPort = (c: EmailConfig) => c.port || (typeof preset(c, "port") === "number" ? (preset(c, "port") as number) : 587);
const smtpUsername = (c: EmailConfig) =>
  c.username || (typeof preset(c, "default_username") === "string" ? (preset(c, "default_username") as string) : "");

export const isConfigured = (c: EmailConfig) => c.provider !== "disabled" && smtpHost(c) !== "" && effectiveFromEmail(c) !== "";

/** EmailConfig.load(); the secret is decrypted only when asked (key derivation). */
export async function loadEmailConfig(withSecret: boolean): Promise<EmailConfig> {
  const r = await emailConfigRow();
  if (!r) return { ...DEFAULT };
  const { secret, ...rest } = r;
  return { ...rest, secret: withSecret ? (decryptStr(secret) ?? "") : "" };
}

/** email_is_configured() for /api/sitesettings. */
export async function emailIsConfigured(): Promise<boolean> {
  try {
    return isConfigured(await loadEmailConfig(false));
  } catch {
    return false;
  }
}

function serialize(c: EmailConfig) {
  return {
    provider: c.provider,
    from_email: c.from_email,
    host: c.host,
    port: c.port,
    use_tls: c.use_tls,
    use_ssl: c.use_ssl,
    username: c.username,
    has_secret: c.secret !== "",
    is_configured: isConfigured(c),
    presets,
  };
}

export async function getEmailConfig() {
  return serialize(await loadEmailConfig(true));
}

/** Django model-field coercion of a posted value for a CharField. */
function charValue(field: string, v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "True" : "False";
  throw ApiError.badRequest(field, "Not a valid string.");
}

function boolValue(field: string, v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "t" || v === "True" || v === "true" || v === "1") return true;
  if (v === 0 || v === "f" || v === "False" || v === "false" || v === "0") return false;
  throw ApiError.badRequest(field, "Must be a valid boolean.");
}

export async function postEmailConfig(req: Request) {
  const raw = await jsonBody<unknown>(req);
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const cfg = await loadEmailConfig(true);
  for (const [field, v] of Object.entries(data)) {
    switch (field) {
      case "provider":
      case "from_email":
      case "host":
      case "username":
        cfg[field] = charValue(field, v);
        break;
      case "use_tls":
      case "use_ssl":
        cfg[field] = boolValue(field, v);
        break;
      case "port": {
        const p = typeof v === "number" && Number.isInteger(v) ? v : typeof v === "string" && /^[+-]?\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
        if (!(p >= 0 && p <= 2147483647)) throw ApiError.badRequest("port", "A valid integer is required.");
        cfg.port = p;
        break;
      }
    }
  }
  if (pyTruthy(data.clear_secret)) cfg.secret = "";
  else if (pyTruthy(data.secret)) cfg.secret = charValue("secret", data.secret);
  await saveEmailConfig({ ...cfg, secret: encryptStr(cfg.secret) });
  return serialize(cfg);
}

/** Send one plain-text message through the stored configuration. */
export async function sendMail(cfg: EmailConfig, subject: string, body: string, to: string): Promise<void> {
  const user = smtpUsername(cfg);
  await smtpSend(
    {
      host: smtpHost(cfg),
      port: smtpPort(cfg),
      useSsl: cfg.use_ssl,
      useTls: cfg.use_tls,
      username: user,
      password: user && cfg.secret ? cfg.secret : "",
    },
    effectiveFromEmail(cfg),
    to,
    subject,
    body,
  );
}

/** The configuration for sending, if email is configured. */
export async function sendingConfig(): Promise<EmailConfig | null> {
  const cfg = await loadEmailConfig(true);
  return isConfigured(cfg) ? cfg : null;
}

export async function testEmail(admin: User, req: Request) {
  const data = (await jsonBody<Record<string, unknown>>(req)) ?? {};
  const cfg = await sendingConfig();
  if (!cfg) return json({ status: false, message: "Email is not configured." }, 400);
  const to = pyTruthy(data.to) && typeof data.to === "string" ? data.to : admin.email;
  const recipient = to.trim();
  if (!recipient) {
    return json({ status: false, message: "No recipient address; set an email on your account or provide one." }, 400);
  }
  try {
    await sendMail(
      cfg,
      "LibrePhotos test email",
      "This is a test message from LibrePhotos. If you received it, your email configuration is working.",
      recipient,
    );
    return { status: true, message: `Test email sent to ${recipient}.` };
  } catch (e) {
    console.error("Test email failed", e);
    return { status: false, message: (e as Error).message };
  }
}
