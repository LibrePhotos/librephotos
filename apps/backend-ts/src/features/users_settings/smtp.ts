// A minimal SMTP client for the plain-text mails LibrePhotos sends (test
// email, password reset): implicit TLS (use_ssl), STARTTLS (use_tls) or
// plain, AUTH PLAIN/LOGIN. Stands in for Django's SMTP backend / lettre.
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

export interface SmtpOptions {
  host: string;
  port: number;
  useSsl: boolean;
  useTls: boolean;
  username: string;
  password: string;
  timeoutMs?: number;
}

class Conn {
  private buf = "";
  private waiters: ((line: string | Error) => void)[] = [];
  private lines: string[] = [];
  private failure: Error | null = null;
  constructor(public sock: Socket | TLSSocket) {
    this.attach();
  }
  attach() {
    this.sock.on("data", (d: Buffer) => {
      this.buf += d.toString("utf8");
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, "");
        this.buf = this.buf.slice(i + 1);
        const w = this.waiters.shift();
        if (w) w(line);
        else this.lines.push(line);
      }
    });
    const fail = (e: Error) => {
      this.failure = e;
      for (const w of this.waiters.splice(0)) w(e);
    };
    this.sock.on("error", fail);
    this.sock.on("close", () => fail(new Error("connection closed")));
  }
  private line(): Promise<string> {
    const l = this.lines.shift();
    if (l !== undefined) return Promise.resolve(l);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((res, rej) => this.waiters.push((x) => (x instanceof Error ? rej(x) : res(x))));
  }
  /** One (possibly multi-line) reply; throws unless its code is expected. */
  async reply(expect: number[]): Promise<string[]> {
    const out: string[] = [];
    for (;;) {
      const l = await this.line();
      out.push(l);
      if (l.length < 4 || l[3] !== "-") break;
    }
    const code = Number(out[out.length - 1].slice(0, 3));
    if (!expect.includes(code)) throw new Error(`SMTP error: ${out.join(" ")}`);
    return out;
  }
  async cmd(line: string, expect: number[]) {
    this.sock.write(line + "\r\n");
    return this.reply(expect);
  }
}

function open(opts: SmtpOptions): Promise<Socket | TLSSocket> {
  return new Promise((resolve, reject) => {
    const s = opts.useSsl
      ? tlsConnect({ host: opts.host, port: opts.port, servername: opts.host }, () => resolve(s))
      : netConnect({ host: opts.host, port: opts.port }, () => resolve(s));
    s.setTimeout(opts.timeoutMs ?? 30_000, () => s.destroy(new Error("SMTP timeout")));
    s.once("error", reject);
  });
}

const headerSafe = (s: string) => s.replace(/[\r\n]+/g, " ");
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?utf-8?b?${Buffer.from(s).toString("base64")}?=`);
/** The bare address of `Name <addr>` or `addr`. */
export const addressOf = (s: string) => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim();

export async function sendMail(opts: SmtpOptions, from: string, to: string, subject: string, body: string): Promise<void> {
  let sock = await open(opts);
  let c = new Conn(sock);
  try {
    await c.reply([220]);
    const me = hostname() || "localhost";
    let ehlo = await c.cmd(`EHLO ${me}`, [250]);
    if (opts.useTls && !opts.useSsl) {
      await c.cmd("STARTTLS", [220]);
      sock.removeAllListeners("data");
      sock.removeAllListeners("error");
      sock.removeAllListeners("close");
      sock = await new Promise<TLSSocket>((resolve, reject) => {
        const t = tlsConnect({ socket: sock as Socket, servername: opts.host }, () => resolve(t));
        t.once("error", reject);
      });
      c = new Conn(sock);
      ehlo = await c.cmd(`EHLO ${me}`, [250]);
    }
    if (opts.username && opts.password) {
      const caps = ehlo.join(" ").toUpperCase();
      if (caps.includes("AUTH") && !/AUTH[ =][^\n]*PLAIN/.test(caps) && caps.includes("LOGIN")) {
        await c.cmd("AUTH LOGIN", [334]);
        await c.cmd(Buffer.from(opts.username).toString("base64"), [334]);
        await c.cmd(Buffer.from(opts.password).toString("base64"), [235]);
      } else {
        await c.cmd(`AUTH PLAIN ${Buffer.from(`\0${opts.username}\0${opts.password}`).toString("base64")}`, [235]);
      }
    }
    await c.cmd(`MAIL FROM:<${addressOf(from)}>`, [250]);
    await c.cmd(`RCPT TO:<${addressOf(to)}>`, [250, 251]);
    await c.cmd("DATA", [354]);
    const msg = [
      `From: ${headerSafe(from)}`,
      `To: ${headerSafe(to)}`,
      `Subject: ${encodeHeader(headerSafe(subject))}`,
      `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
      `Message-ID: <${randomUUID()}@${me}>`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      ...(Buffer.from(body).toString("base64").match(/.{1,76}/g) ?? []),
    ].join("\r\n");
    await c.cmd(`${msg}\r\n.`, [250]);
    await c.cmd("QUIT", [221]).catch(() => {});
  } finally {
    sock.destroy();
  }
}
