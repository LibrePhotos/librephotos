// /api/healthz probes (port of lp_server's healthz handlers + lp_db::health).
import { client } from "../lib/db";
import { json } from "../lib/http";

const ping = () => client`SELECT 1`.then(() => true, () => false);
const queuePing = () => client`SELECT 1 FROM job_queue LIMIT 1`.then(() => true, () => false);
const check = (ok: boolean, what: string) => (ok ? { status: "ok" } : { status: "error", error: `${what} unreachable` });

export const healthz = () => json({ status: "ok" });
export const postgresql = async () => {
  const ok = await ping();
  return json(check(ok, "database"), ok ? 200 : 503);
};
export const queue = async () => {
  const ok = await queuePing();
  return json(check(ok, "queue broker"), ok ? 200 : 503);
};
export const ready = async () => {
  const [db, q] = await Promise.all([ping(), queuePing()]);
  const ok = db && q;
  return json({ status: ok ? "ok" : "error", checks: { postgresql: check(db, "database"), queue: check(q, "queue broker") } }, ok ? 200 : 503);
};
