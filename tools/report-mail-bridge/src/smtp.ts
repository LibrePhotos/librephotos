import type { Socket } from "bun";
import type { Reply } from "./intake";
import type { Store } from "./store";

// A receive-only SMTP server: the subset of RFC 5321 a mail server needs to
// deliver to one address. It never sends, relays or forwards mail, offers no
// AUTH, and keeps nothing of the sender or the recipients.

// RFC 5321 allows 512 bytes for a command line; mail servers send less.
const MAX_COMMAND_BYTES = 4096;
const MAX_BAD_COMMANDS = 10;
const MAX_RECIPIENTS = 20;
const LF = 0x0a;

export type SessionOptions = {
  hostname: string;
  /** The one address mail is taken for. */
  recipient: string;
  maxMessageBytes: number;
  /** False when this client sent too many messages lately. */
  allowMessage: () => boolean;
  receive: (message: Uint8Array) => Promise<Reply>;
};

type Transaction = { mail: boolean; recipients: number; accepted: boolean };

const fresh = (): Transaction => ({ mail: false, recipients: 0, accepted: false });

/** The address in `FROM:<...>` or `TO:<...>`, and the parameters after it. */
function parsePath(argument: string, keyword: string): { address: string; params: string } | null {
  const match = new RegExp(`^${keyword}:\\s*<([^<>]*)>\\s*(.*)$`, "i").exec(argument.trim());
  return match ? { address: match[1]!, params: match[2]! } : null;
}

function declaredSize(params: string): number {
  const match = /(?:^|\s)SIZE=(\d+)/i.exec(params);
  return match ? Number(match[1]) : 0;
}

export class SmtpSession {
  private pending: Uint8Array = new Uint8Array(0);
  private transaction = fresh();
  private greeted = false;
  private badCommands = 0;
  private closed = false;
  private data: Uint8Array[] | null = null;
  private dataBytes = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: SessionOptions,
    private readonly write: (text: string) => void,
    private readonly hangUp: () => void,
  ) {}

  greet(): void {
    this.reply(220, `${this.options.hostname} ESMTP LibrePhotos report bridge, receive only`);
  }

  /** Feed bytes from the client; resolves once every complete line is handled. */
  receive(chunk: Uint8Array): Promise<void> {
    this.queue = this.queue.then(() => this.process(chunk));
    return this.queue;
  }

  timeout(): void {
    this.close(421, "4.4.2 Idle for too long, closing");
  }

  private reply(code: number, text: string): void {
    if (!this.closed) this.write(`${code} ${text}\r\n`);
  }

  private close(code: number, text: string): void {
    this.reply(code, text);
    this.closed = true;
    this.hangUp();
  }

  private takeLine(): Uint8Array | null {
    const end = this.pending.indexOf(LF);
    if (end < 0) return null;
    const line = this.pending.subarray(0, end > 0 && this.pending[end - 1] === 0x0d ? end - 1 : end);
    this.pending = this.pending.subarray(end + 1);
    return line;
  }

  private async process(chunk: Uint8Array): Promise<void> {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    while (!this.closed) {
      const line = this.takeLine();
      if (line === null) break;
      if (this.data) await this.dataLine(line);
      else this.command(new TextDecoder().decode(line));
    }
    if (this.closed) return;
    if (!this.data && this.pending.length > MAX_COMMAND_BYTES) this.close(500, "5.5.2 Line too long");
    if (this.data && this.pending.length > this.options.maxMessageBytes) {
      // One line longer than a whole message: drop it, the message is refused anyway.
      this.dataBytes += this.pending.length;
      this.pending = new Uint8Array(0);
    }
  }

  private async dataLine(line: Uint8Array): Promise<void> {
    if (line.length === 1 && line[0] === 0x2e) return this.endData();
    const text = line[0] === 0x2e ? line.subarray(1) : line;
    this.dataBytes += text.length + 2;
    if (this.dataBytes <= this.options.maxMessageBytes) {
      this.data?.push(text, new Uint8Array([0x0d, 0x0a]));
    }
  }

  private async endData(): Promise<void> {
    const parts = this.data ?? [];
    const tooBig = this.dataBytes > this.options.maxMessageBytes;
    this.data = null;
    this.dataBytes = 0;
    this.transaction = fresh();
    if (tooBig) return this.reply(552, "5.3.4 Message too big");
    const answer = await this.options.receive(Buffer.concat(parts));
    this.reply(answer.code, answer.text);
  }

  private bad(code: number, text: string): void {
    this.badCommands++;
    if (this.badCommands > MAX_BAD_COMMANDS) this.close(421, "4.7.0 Too many errors, closing");
    else this.reply(code, text);
  }

  private command(line: string): void {
    const space = line.indexOf(" ");
    const verb = (space < 0 ? line : line.slice(0, space)).toUpperCase();
    const argument = space < 0 ? "" : line.slice(space + 1);
    switch (verb) {
      case "EHLO":
      case "HELO":
        return this.hello(verb, argument);
      case "MAIL":
        return this.mail(argument);
      case "RCPT":
        return this.rcpt(argument);
      case "DATA":
        return this.startData();
      case "RSET":
        this.transaction = fresh();
        return this.reply(250, "2.0.0 OK");
      case "NOOP":
        return this.reply(250, "2.0.0 OK");
      case "QUIT":
        return this.close(221, "2.0.0 Bye");
      case "VRFY":
        return this.reply(252, "2.5.0 Cannot verify, send the mail");
      case "STARTTLS":
      case "AUTH":
      case "EXPN":
      case "BDAT":
      case "ETRN":
      case "TURN":
        return this.bad(502, "5.5.1 Not implemented");
      default:
        return this.bad(500, "5.5.2 Command not recognized");
    }
  }

  private hello(verb: string, argument: string): void {
    if (!argument.trim()) return this.bad(501, "5.5.4 Say who you are");
    this.greeted = true;
    this.transaction = fresh();
    const host = this.options.hostname;
    if (verb === "HELO") return this.reply(250, host);
    const lines = [host, `SIZE ${this.options.maxMessageBytes}`, "8BITMIME", "PIPELINING"];
    this.write(lines.map((text, i) => `250${i === lines.length - 1 ? " " : "-"}${text}\r\n`).join(""));
  }

  private mail(argument: string): void {
    if (!this.greeted) return this.bad(503, "5.5.1 Say EHLO first");
    if (this.transaction.mail) return this.bad(503, "5.5.1 Already have a sender");
    const path = parsePath(argument, "FROM");
    if (!path) return this.bad(501, "5.5.4 Syntax: MAIL FROM:<address>");
    if (declaredSize(path.params) > this.options.maxMessageBytes) {
      return this.reply(552, "5.3.4 Message too big");
    }
    this.transaction.mail = true;
    this.reply(250, "2.1.0 OK");
  }

  private rcpt(argument: string): void {
    if (!this.transaction.mail) return this.bad(503, "5.5.1 Need MAIL first");
    if (this.transaction.recipients >= MAX_RECIPIENTS) return this.reply(452, "4.5.3 Too many recipients");
    const path = parsePath(argument, "TO");
    if (!path) return this.bad(501, "5.5.4 Syntax: RCPT TO:<address>");
    this.transaction.recipients++;
    if (path.address.toLowerCase() !== this.options.recipient.toLowerCase()) {
      return this.reply(550, "5.1.1 No such recipient here, and this server does not relay");
    }
    this.transaction.accepted = true;
    this.reply(250, "2.1.5 OK");
  }

  private startData(): void {
    if (!this.transaction.mail) return this.bad(503, "5.5.1 Need MAIL first");
    if (!this.transaction.accepted) return this.reply(554, "5.5.1 No valid recipients");
    if (!this.options.allowMessage()) {
      this.transaction = fresh();
      return this.reply(451, "4.7.1 Too many messages, try again later");
    }
    this.data = [];
    this.dataBytes = 0;
    this.reply(354, "End data with <CR><LF>.<CR><LF>");
  }
}

// --- The listener ------------------------------------------------------------

export type ServerLimits = {
  maxConnections: number;
  connectionsPerClientPerHour: number;
  messagesPerClientPerHour: number;
  idleSeconds: number;
};

type ListenOptions = Omit<SessionOptions, "allowMessage"> & {
  port: number;
  store: Store;
  limits: ServerLimits;
  log: (line: string) => void;
};

type Connection = { session: SmtpSession | null; unsent: string };

/** `::ffff:1.2.3.4` and `1.2.3.4` are one client. */
function clientAddress(socket: Socket<Connection>): string {
  return socket.remoteAddress.replace(/^::ffff:/i, "");
}

function writer(socket: Socket<Connection>): (text: string) => void {
  return (text) => {
    socket.data.unsent += text;
    flush(socket);
  };
}

function flush(socket: Socket<Connection>): void {
  if (!socket.data.unsent) return;
  const written = socket.write(socket.data.unsent);
  socket.data.unsent = socket.data.unsent.slice(Math.max(written, 0));
}

function refuse(socket: Socket<Connection>, text: string): void {
  socket.write(`421 ${text}\r\n`);
  socket.end();
}

export function listenSmtp(options: ListenOptions) {
  const { store, limits, log } = options;
  let open = 0;
  return Bun.listen<Connection>({
    hostname: "0.0.0.0",
    port: options.port,
    socket: {
      open(socket) {
        socket.data = { session: null, unsent: "" };
        open++;
        const client = store.clientKey(clientAddress(socket));
        if (open > limits.maxConnections) return refuse(socket, "4.7.0 Too busy, try again later");
        if (!store.take(`connections:${client}`, limits.connectionsPerClientPerHour)) {
          log("smtp connection refused: rate limit");
          return refuse(socket, "4.7.0 Too many connections, try again later");
        }
        socket.timeout(limits.idleSeconds);
        const allowMessage = () => store.take(`messages:${client}`, limits.messagesPerClientPerHour);
        const session = new SmtpSession({ ...options, allowMessage }, writer(socket), () => socket.end());
        socket.data.session = session;
        session.greet();
      },
      data(socket, chunk) {
        void socket.data.session?.receive(chunk).catch(() => socket.end());
      },
      drain(socket) {
        flush(socket);
      },
      timeout(socket) {
        socket.data.session?.timeout();
      },
      close() {
        open--;
      },
      error() {
        // A client that drops the connection; nothing to log about it.
      },
    },
  });
}
