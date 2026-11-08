import { describe, expect, test } from "bun:test";
import type { Reply } from "../src/intake";
import { SmtpSession } from "../src/smtp";

const RECIPIENT = "bugs@reports.niaz.omg.lol";

function session(options: { allowMessage?: () => boolean; reply?: Reply; maxMessageBytes?: number } = {}) {
  const out: string[] = [];
  const messages: string[] = [];
  let closed = false;
  const smtp = new SmtpSession(
    {
      hostname: "reports.niaz.omg.lol",
      recipient: RECIPIENT,
      maxMessageBytes: options.maxMessageBytes ?? 1000,
      allowMessage: options.allowMessage ?? (() => true),
      receive: async (message) => {
        messages.push(new TextDecoder().decode(message));
        return options.reply ?? { code: 250, text: "2.0.0 Thanks" };
      },
    },
    (text) => out.push(text),
    () => {
      closed = true;
    },
  );
  smtp.greet();
  const send = (text: string) => smtp.receive(new TextEncoder().encode(text));
  const codes = () => out.map((line) => line.slice(0, 3));
  return { out, messages, send, codes, closed: () => closed, smtp };
}

const transaction = (body: string) =>
  `EHLO client.example\r\nMAIL FROM:<a@example.org>\r\nRCPT TO:<${RECIPIENT}>\r\nDATA\r\n${body}\r\n.\r\n`;

describe("SmtpSession", () => {
  test("greets with its host name", () => {
    const { out } = session();
    expect(out).toEqual(["220 reports.niaz.omg.lol ESMTP LibrePhotos report bridge, receive only\r\n"]);
  });

  test("advertises the size limit", async () => {
    const { out, send } = session();
    await send("EHLO client.example\r\n");
    expect(out[1]).toBe("250-reports.niaz.omg.lol\r\n250-SIZE 1000\r\n250-8BITMIME\r\n250 PIPELINING\r\n");
  });

  test("receives a message for the one recipient and answers what intake says", async () => {
    const { codes, send, messages, out } = session({ reply: { code: 250, text: "2.0.0 1 forwarded" } });
    await send(transaction("Subject: x\r\n\r\nhello"));
    expect(codes()).toEqual(["220", "250", "250", "250", "354", "250"]);
    expect(out.at(-1)).toBe("250 2.0.0 1 forwarded\r\n");
    expect(messages).toEqual(["Subject: x\r\n\r\nhello\r\n"]);
  });

  test("passes a refusal from intake on", async () => {
    const { send, out } = session({ reply: { code: 550, text: "5.6.0 No report" } });
    await send(transaction("hello"));
    expect(out.at(-1)).toBe("550 5.6.0 No report\r\n");
  });

  test("takes the recipient in any case", async () => {
    const { send, codes } = session();
    await send("HELO c\r\nMAIL FROM:<>\r\nRCPT TO:<BUGS@Reports.Niaz.Omg.Lol>\r\n");
    expect(codes()).toEqual(["220", "250", "250", "250"]);
  });

  test("refuses every other recipient, so it never relays", async () => {
    const { send, codes, messages } = session();
    await send("EHLO c\r\nMAIL FROM:<a@b.c>\r\nRCPT TO:<someone@gmail.com>\r\nRCPT TO:<bugs@reports.niaz.omg.lol.evil.com>\r\nDATA\r\n");
    expect(codes()).toEqual(["220", "250", "250", "550", "550", "554"]);
    expect(messages).toEqual([]);
  });

  test("wants the commands in order", async () => {
    const { send, codes } = session();
    await send("MAIL FROM:<a@b.c>\r\nEHLO c\r\nRCPT TO:<bugs@reports.niaz.omg.lol>\r\nDATA\r\n");
    expect(codes()).toEqual(["220", "503", "250", "503", "503"]);
  });

  test("refuses a declared size over the limit", async () => {
    const { send, codes } = session();
    await send("EHLO c\r\nMAIL FROM:<a@b.c> SIZE=5000\r\n");
    expect(codes()).toEqual(["220", "250", "552"]);
  });

  test("refuses a message over the limit and does not pass it on", async () => {
    const { send, out, messages } = session({ maxMessageBytes: 100 });
    await send(transaction("x".repeat(60) + "\r\n" + "y".repeat(60)));
    expect(out.at(-1)?.slice(0, 3)).toBe("552");
    expect(messages).toEqual([]);
  });

  test("does not buffer an endless data line", async () => {
    const { send, out, messages } = session({ maxMessageBytes: 100 });
    await send(`EHLO c\r\nMAIL FROM:<>\r\nRCPT TO:<${RECIPIENT}>\r\nDATA\r\n`);
    for (let i = 0; i < 10; i++) await send("z".repeat(60));
    await send("\r\n.\r\n");
    expect(out.at(-1)?.slice(0, 3)).toBe("552");
    expect(messages).toEqual([]);
  });

  test("removes dot stuffing", async () => {
    const { send, messages } = session();
    await send(transaction("..leading dot\r\n.\tstill"));
    expect(messages).toEqual([".leading dot\r\n\tstill\r\n"]);
  });

  test("handles a message split across packets", async () => {
    const { send, messages, codes } = session();
    const text = transaction("first line\r\nsecond line");
    for (let i = 0; i < text.length; i += 7) await send(text.slice(i, i + 7));
    expect(messages).toEqual(["first line\r\nsecond line\r\n"]);
    expect(codes().at(-1)).toBe("250");
  });

  test("can take two messages in one session", async () => {
    const { send, messages } = session();
    await send(transaction("one"));
    await send(`MAIL FROM:<a@b.c>\r\nRCPT TO:<${RECIPIENT}>\r\nDATA\r\ntwo\r\n.\r\n`);
    expect(messages).toEqual(["one\r\n", "two\r\n"]);
  });

  test("forgets the transaction on RSET", async () => {
    const { send, codes } = session();
    await send(`EHLO c\r\nMAIL FROM:<a@b.c>\r\nRCPT TO:<${RECIPIENT}>\r\nRSET\r\nDATA\r\n`);
    expect(codes()).toEqual(["220", "250", "250", "250", "250", "503"]);
  });

  test("offers no TLS, no AUTH and no address checks", async () => {
    const { send, codes } = session();
    await send("EHLO c\r\nSTARTTLS\r\nAUTH PLAIN abc\r\nVRFY bugs\r\nEXPN list\r\nNOOP\r\n");
    expect(codes()).toEqual(["220", "250", "502", "502", "252", "502", "250"]);
  });

  test("says goodbye on QUIT", async () => {
    const { send, codes, closed } = session();
    await send("QUIT\r\n");
    expect(codes()).toEqual(["220", "221"]);
    expect(closed()).toBe(true);
  });

  test("hangs up after too many bad commands", async () => {
    const { send, codes, closed } = session();
    await send("GET / HTTP/1.1\r\n".repeat(12));
    expect(codes().at(-1)).toBe("421");
    expect(closed()).toBe(true);
  });

  test("refuses an overlong command line", async () => {
    const { send, codes, closed } = session();
    await send(`EHLO ${"x".repeat(5000)}`);
    expect(codes()).toEqual(["220", "500"]);
    expect(closed()).toBe(true);
  });

  test("asks the client to come back when it sent too many messages", async () => {
    const { send, codes, messages } = session({ allowMessage: () => false });
    await send(transaction("hello"));
    expect(codes()).toEqual(["220", "250", "250", "250", "451", "500", "500"]);
    expect(messages).toEqual([]);
  });

  test("hangs up on an idle client", () => {
    const { smtp, out, closed } = session();
    smtp.timeout();
    expect(out.at(-1)?.slice(0, 3)).toBe("421");
    expect(closed()).toBe(true);
  });
});
