# Report mail bridge

LibrePhotos admins can download an error report from the Error reports page
(a JSON file) and email it to the maintainers. This small server receives those
emails itself, on the maintainers' own server, and forwards each report to the
maintainers' GlitchTip project with the reports that were sent directly. Mail
without a valid report (a bug report in words, a screenshot) is kept for the
maintainers to read. No mail provider or other third party ever sees the mail.

It is one Bun program: a receive-only SMTP listener, a `/health` endpoint and a
small inbox API. Read it in this order: `src/main.ts`, `src/smtp.ts`,
`src/intake.ts`, `src/report.ts`, `src/glitchtip.ts`, `src/store.ts`,
`src/http.ts`.

## What happens to an email

**Accepted.** Mail to the one address in `REPORT_ADDRESS`
(`bugs@reports.niaz.omg.lol`), up to 5 MiB. The server answers `550` to every
other recipient, so it is not an open relay.

**Parsed.** The message is parsed as MIME (`postal-mime`). Attachments named
`*.json` or typed `application/json` are candidate reports. What happens next
depends on whether at least one of them is a valid report.

**Checked.** Each candidate must be a LibrePhotos error report exactly as the
Download button writes it (`ErrorReportDownloadView` in
`apps/backend/api/views/error_reports.py`): a JSON object holding only the
fields LibrePhotos' scrubber keeps (`apps/backend/api/error_reports/scrub.py`),
with their types and size limits, `tags.source` set to `server` or `browser`,
and an exception or a message. Any other field, a wrong type or a file over
256 KiB fails the check.

**Forwarded.** For each new, valid report, GlitchTip receives one Sentry
envelope with:

- the report's own fields, unchanged except that email addresses, IP addresses
  and URLs are replaced by `<email>`, `<ip>` and `<url>` once more (LibrePhotos
  already did this; this is a second pass);
- a new `event_id`, derived from the report's hash, so a report sent twice is
  one event;
- the tag `received_via=email`.

Nothing from the email itself is added. For a mail with a valid report, the
body, the sender, the recipients, the subject and every other header are
dropped: they are never logged, stored or forwarded.

**Kept, when there is no valid report.** A mail without a valid report is kept
in the inbox so the maintainers can read it: the time it arrived, the envelope
sender and the `From` header, the subject, the text (taken from the HTML when
there is no text part, cut at 100,000 characters), the names, types and sizes
of its attachments, a few headers (`To`, `Cc`, `Reply-To`, `Date`,
`Message-ID`), and the raw message (the `.eml`, so screenshots and logs are not
lost). It is deleted after 30 days, or earlier when the inbox holds more than
500 mails or 500 MB: the oldest go first. It is never forwarded anywhere. An
empty mail (no text and no attachments) is refused.

**Answered.**

| Reply | When |
| --- | --- |
| `250` | At least one report was valid: duplicates and invalid attachments next to it are skipped, and a report GlitchTip refuses as malformed is dropped. Or there was no valid report and the mail was kept in the inbox. |
| `550` | The mail is empty, or cannot be parsed. The sender's mail server tells the sender. |
| `552` | More than 10 JSON attachments in one email, or the message is over 5 MiB. |
| `451` | GlitchTip cannot be reached (or refuses the DSN), more than 100 reports arrived this hour, or more than 50 mails were kept this hour. The sender's mail server tries again later. |
| `421` | Too many connections at once or from one client this hour, or the client idled for 60 seconds. |

**Stored.** In SQLite (`/data/bridge.sqlite`), only:

| Table | Holds | Kept |
| --- | --- | --- |
| `reports` | SHA-256 of each forwarded report, first and last time it was received | 30 days after it was last received |
| `inbox` | Mail without a valid report, as listed above | 30 days, at most 500 mails and 500 MB |
| `counters` | Rate-limit counts per hour: `reports`, `inbox`, and per client `connections:<key>`, `messages:<key>` and `auth-failures:<key>`, where the key is a salted hash of the client's IP address | the current hour only |
| `settings` | The random salt for those keys | for good |

A cleanup runs at start and every hour. No report content and no IP address is
written to disk, and email addresses only as part of a kept inbox mail.

**Read.** The maintainers read the inbox over HTTPS with a key (see Inbox API).

**Logged.** One line per message with the reply code and counts
(`message reply=250 forwarded=1 duplicates=0 invalid=0 refused=0`, or
`message reply=250 kept=inbox`). Never an address, a subject, mail text, report
content or the API key.

**Never sent.** The server sends and relays no mail, and offers no `AUTH`.
Its only outgoing connection is the HTTPS POST to GlitchTip.

**No TLS yet.** `STARTTLS` is not offered: the certificate for
`reports.niaz.omg.lol` belongs to Coolify's proxy, and borrowing it would be a
fragile hack. Mail arrives in plain text. Reports in it are already scrubbed
by LibrePhotos; other mail travels like any unencrypted mail.

## Limits

Set in `src/main.ts`: 5 MiB per message, 10 reports per email, 100 reports per
hour overall, 50 inbox mails per hour, 20 connections at once, 30 connections
and 10 messages per client per hour, 60 seconds idle. The inbox's size limits
are in `src/store.ts`.

## Inbox API

Only there when `INBOX_API_KEY` is set; otherwise every `/api` route answers
404. Every request needs `Authorization: Bearer <key>`. The key is compared in
constant time, a wrong key is answered after a second, and a client with 10
wrong keys in an hour gets `429` for the rest of that hour.

| Request | Answer |
| --- | --- |
| `GET /api/inbox` | `{"messages": [...]}`, newest first: id, received, from, subject, a 200-character snippet, attachment names |
| `GET /api/inbox/:id` | The mail: sender, from, subject, headers, full text, attachments (name, type, size) |
| `GET /api/inbox/:id/raw` | The raw message, `message/rfc822`, as `inbox-<id>.eml` |
| `DELETE /api/inbox/:id` | `204`, and the mail is gone |

```sh
curl -H "Authorization: Bearer $KEY" https://reports.niaz.omg.lol/api/inbox
```

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `REPORT_ADDRESS` | (required) | The one address mail is accepted for. Its domain is the SMTP host name. |
| `GLITCHTIP_DSN` | (required) | The GlitchTip project's DSN. |
| `DATABASE` | `/data/bridge.sqlite` | |
| `SMTP_PORT` | `2525` | Publish it as host port 25. |
| `HTTP_PORT` | `3000` | Serves `GET /health` and the inbox API. |
| `INBOX_API_KEY` | (unset: no API) | The inbox API's key: 32 random bytes as hex, for example `openssl rand -hex 32`. |

## Develop

```sh
bun install
bun test
bun run typecheck
REPORT_ADDRESS=bugs@localhost GLITCHTIP_DSN=http://key@127.0.0.1:8000/1 DATABASE=bridge.sqlite bun run start
```

`bun run build` compiles one executable (`bun build --compile --bytecode --minify`).
The `Dockerfile` runs the tests, compiles, and copies only that binary onto
Debian slim (about 200 MB unpacked, mostly the Bun runtime inside the binary;
Debian keeps `/bin/sh` for Coolify's health check). It builds on amd64 and arm64.

## Deploy (Coolify)

The app is a Coolify "Dockerfile" application. Until this directory is on a
branch Coolify can check out, generate a Dockerfile with the sources written
into it and paste or upload that:

```sh
bun run coolify-dockerfile.ts > Dockerfile.coolify
```

Settings: domain `https://reports.niaz.omg.lol` on port 3000, port mapping
`25:2525`, environment `REPORT_ADDRESS`, `GLITCHTIP_DSN` and `INBOX_API_KEY`
(runtime only, not at build time), a persistent volume
on `/data`, health check command `report-mail-bridge health`. Port 25 must be
free on the host and open in the firewall.

## DNS

At omg.lol, for `reports.niaz.omg.lol`:

| Type | Name | Value |
| --- | --- | --- |
| A | `reports.niaz` | the server's IPv4 address |
| MX | `reports.niaz` | `10 reports.niaz.omg.lol.` |

The trailing dot matters: without it omg.lol appends its zone
(`reports.niaz.omg.lol.omg.lol`). No SPF, DKIM or DMARC: the server sends no mail.

## Dependencies

- `postal-mime` (MIT-0, no dependencies of its own), pinned: MIME is easy to
  get wrong (nested multiparts, encodings, encoded file names), and this is a
  small, widely used parser that runs on Bun and in the compiled binary.
- `typescript` and `@types/bun`, for `bun run typecheck` only.

Everything else is Bun's own: `Bun.listen`, `Bun.serve`, `bun:sqlite`, `fetch`.

## License and security

MIT, like the rest of LibrePhotos (see `LICENSE` at the repository root).
Please report security problems privately as described in `SECURITY.md` at the
repository root, not in a public issue.
