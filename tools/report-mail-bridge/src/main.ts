import { glitchTipSender, parseDsn } from "./glitchtip";
import { createIntake } from "./intake";
import { listenSmtp } from "./smtp";
import { HOUR, Store } from "./store";

// The LibrePhotos report mail bridge: an SMTP listener that takes error report
// files mailed to one address and forwards them to GlitchTip, and /health.

const LIMITS = {
  maxMessageBytes: 5 * 1024 * 1024,
  reportsPerMail: 10,
  reportsPerHour: 100,
  maxConnections: 20,
  connectionsPerClientPerHour: 30,
  messagesPerClientPerHour: 10,
  idleSeconds: 60,
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function config() {
  const recipient = required("REPORT_ADDRESS");
  const dsn = required("GLITCHTIP_DSN");
  parseDsn(dsn);
  return {
    recipient,
    hostname: recipient.split("@")[1] ?? recipient,
    dsn,
    smtpPort: Number(process.env.SMTP_PORT ?? 2525),
    httpPort: Number(process.env.HTTP_PORT ?? 3000),
    database: process.env.DATABASE ?? "/data/bridge.sqlite",
  };
}

/** `report-mail-bridge health`: the container's health check, without curl. */
async function health(port: number): Promise<never> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    process.exit(response.ok ? 0 : 1);
  } catch {
    process.exit(1);
  }
}

function serve() {
  const settings = config();
  const log = (line: string) => console.log(line);
  const store = new Store(settings.database);
  store.cleanup();
  setInterval(() => store.cleanup(), HOUR);
  const intake = createIntake({ store, send: glitchTipSender(settings.dsn), limits: LIMITS, log });
  listenSmtp({
    port: settings.smtpPort,
    hostname: settings.hostname,
    recipient: settings.recipient,
    maxMessageBytes: LIMITS.maxMessageBytes,
    receive: intake,
    store,
    limits: LIMITS,
    log,
  });
  Bun.serve({
    port: settings.httpPort,
    fetch: (request) =>
      new URL(request.url).pathname === "/health"
        ? new Response("ok\n")
        : new Response("Not found\n", { status: 404 }),
  });
  log(`listening: smtp ${settings.smtpPort}, http ${settings.httpPort}`);
}

if (process.argv.includes("health")) void health(Number(process.env.HTTP_PORT ?? 3000));
else serve();
