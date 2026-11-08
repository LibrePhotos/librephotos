# Report mail bridge

LibrePhotos admins can download an error report from the Error reports page
(a JSON file) and email it to the maintainers. This small server receives those
emails itself, on the maintainers' own server, and forwards each report to the
maintainers' GlitchTip project with the reports that were sent directly. No
mail provider or other third party ever sees the mail.

It is one Bun program: a receive-only SMTP listener and a `/health` endpoint.
Read it in this order: `src/main.ts`, `src/smtp.ts`, `src/intake.ts`,
`src/report.ts`, `src/glitchtip.ts`, `src/store.ts`.

## What happens to an email

**Accepted.** Mail to the one address in `REPORT_ADDRESS`
(`bugs@reports.niaz.omg.lol`), up to 5 MiB. The server answers `550` to every
other recipient, so it is not an open relay.

**Parsed.** The message is parsed as MIME (`postal-mime`). Only attachments
named `*.json` or typed `application/json` are kept. The body, the sender, the
recipients, the subject and every other header are dropped: they are never
logged, stored or forwarded.

**Checked.** Each attachment must be a LibrePhotos error report exactly as the
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

Nothing from the email itself is added.

**Answered.**

| Reply | When |
| --- | --- |
| `250` | At least one report was valid. Duplicates and invalid attachments next to it are skipped. A report GlitchTip refuses as malformed is dropped. |
| `550` | No JSON attachment, or none of them is a valid report. The sender's mail server tells the sender. |
| `552` | More than 10 reports in one email, or the message is over 5 MiB. |
| `451` | GlitchTip cannot be reached (or refuses the DSN), or more than 100 reports arrived this hour. The sender's mail server tries again later. |
| `421` | Too many connections at once or from one client this hour, or the client idled for 60 seconds. |

**Stored.** In SQLite (`/data/bridge.sqlite`), only:

| Table | Holds | Kept |
| --- | --- | --- |
| `reports` | SHA-256 of each forwarded report, first and last time it was received | 30 days after it was last received |
| `counters` | Rate-limit counts per hour: `reports`, and per client `connections:<key>` and `messages:<key>`, where the key is a salted hash of the client's IP address | the current hour only |
| `settings` | The random salt for those keys | for good |

A cleanup runs at start and every hour. No report content, no email address and
no IP address is written to disk.

**Logged.** One line per message with the reply code and counts
(`message reply=250 forwarded=1 duplicates=0 invalid=0 refused=0`). Never an
address, a subject or report content.

**Never sent.** The server sends and relays no mail, and offers no `AUTH`.
Its only outgoing connection is the HTTPS POST to GlitchTip.

**No TLS yet.** `STARTTLS` is not offered: the certificate for
`reports.niaz.omg.lol` belongs to Coolify's proxy, and borrowing it would be a
fragile hack. Mail arrives in plain text. The reports in it are already
scrubbed by LibrePhotos.

## Limits

Set in `src/main.ts`: 5 MiB per message, 10 reports per email, 100 reports per
hour overall, 20 connections at once, 30 connections and 10 messages per client
per hour, 60 seconds idle.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `REPORT_ADDRESS` | (required) | The one address mail is accepted for. Its domain is the SMTP host name. |
| `GLITCHTIP_DSN` | (required) | The GlitchTip project's DSN. |
| `DATABASE` | `/data/bridge.sqlite` | |
| `SMTP_PORT` | `2525` | Publish it as host port 25. |
| `HTTP_PORT` | `3000` | Serves `GET /health`. |

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
`25:2525`, environment `REPORT_ADDRESS` and `GLITCHTIP_DSN`, a persistent volume
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
