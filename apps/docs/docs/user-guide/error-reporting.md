---
title: "Error reporting"
description: "Saved error reports, what they hold, and how to share them with the maintainers or your own server"
sidebar_position: 18
---

<Since version="1.6.0" />

When something breaks, LibrePhotos saves a report of the error on your server. Nothing leaves the server until an admin decides so: errors are kept, scrubbed, so you can still share them later, or never.

Both the backend (the web server and the background workers) and the web app save their errors here. The web app hands its errors to your server, never to a reporting server directly. <Since version="1.7.0" /> An error whose stack has no line of the web app's own scripts, such as one a browser extension throws in the page, is not saved.

## The choices

**Admin area > Error reporting** decides where new reports go:

- **Off: keep reports on this server** (the default). Reports are saved and nothing is sent.
- **My own server**: your own [GlitchTip](https://glitchtip.com) or [Sentry](https://sentry.io) project. Set its DSN in [`SENTRY_DSN`](../installation/environment-variables.md#error-reporting) and restart; until then this choice is greyed out.
- **Share with the LibrePhotos maintainers**: the maintainers' GlitchTip project. It helps us find and fix bugs we would otherwise only hear about in an issue.

A new server asks during its first-time setup, in the **Errors** step; **Off: keep reports on this server** is the first button. A server set up before error reporting existed asks its admins once instead, in a **Help fix bugs in LibrePhotos?** dialog with the same choices and **Not now**. Whichever admin answers first answers for the server: the question does not come back, on any device, and the choice can be changed any time under **Admin area > Error reporting**.

Turning sharing on while reports are saved asks a second question first: **Send the saved reports too?** It lists the saved reports. **Only new reports** leaves them on your server; **Send them too** sends them as well.

## The Error reports page

**Error reports** (linked from the setting, at `/admin/error-reports`) lists the saved reports, newest first: the error, whether it came from the server or the web app, when it last happened, how often, the release, and whether it was sent. Each report has:

- **Send once**: send just this report, without turning sharing on. It goes to the server chosen under Error reporting, or to the maintainers while it is off.
- **Download**: save the report as a JSON file, exactly what would be sent.
- **Email**: open your mail app with a message to the maintainers (`bugs@reports.niaz.omg.lol`) that names the error. Mail links cannot attach files, so attach the file **Download** saved. This works for a server without internet access too. The address is received by the maintainers' own [report mail bridge](https://github.com/LibrePhotos/librephotos/tree/dev/tools/report-mail-bridge), which runs on a server in Germany: it passes valid report files on to the maintainers' error tracker and drops everything else in the mail, including your address, the subject and the text. A mail without a valid report file is kept for 30 days with your address, the subject, the text and the attachments so the maintainers can read it, and is then deleted.
- **Delete**: remove it from your server.

**Send all** sends every report not sent yet; **Delete all** removes them all. Reports already sent stay on the server they went to.

At most 30 reports are kept, none older than 30 days. The same error again within a day counts as another occurrence of the same report.

## What a report holds

A report is a [Sentry event](https://develop.sentry.dev/sdk/data-model/event-payloads/) rebuilt from an allowlist, so a field LibrePhotos does not know never gets through. It holds:

- the event's id, time, level (`error`), platform, logger name, the LibrePhotos release and the environment (`production`);
- the error's type and message, and its stack: file, function, line and column, and up to five lines of code around each line;
- for a logged error, the log message with its values filled in;
- the name and version of the error reporting SDK, the Python runtime, the operating system and the browser, and for a web app error the browser's User-Agent;
- for a server error, the HTTP method and the URL pattern (like `/api/photos/{pk}/`), never the address itself;
- whether it came from the server or the web app.

Before a report is saved, every text in it is scrubbed. These are replaced by placeholders such as `<library>`, `<name>` or `<email>`:

- paths below a library folder, the data folder and the media folder, other absolute paths, and home folders;
- the file names of photos, videos, RAW and sidecar files;
- usernames, first and last names and email addresses of users, and the names of people, albums, events and tags;
- email addresses, IP addresses, URLs and this server's host names.

<Since version="1.7.0" /> A name is replaced only in the text of a message, not in the names of code (files, modules, functions, error types) that the stack lists. A name that is a number, a word such as "from" or "not", or an HTTP method such as "POST" is left alone, so a tag with that name does not blank it out of every report.

A report never holds: your photos, the request (its address, query, body, cookies and headers, login tokens included), the signed-in user, breadcrumbs, local variables, extra data, tags, the installed packages, other threads or the server's name.

Paths of LibrePhotos' own code are kept, made relative (`api/photos/files.py`, `site-packages/django/...`), so a stack stays readable. The web app's script files are kept as paths only (`/assets/index-abc123.js`).

Sending a report is one HTTPS request from your server to the chosen server, with nothing else about your server. That server sees your server's IP address, as with any connection.

## For your own server

[`SENTRY_DSN`](../installation/environment-variables.md#error-reporting) takes the DSN of a GlitchTip or Sentry project. Your server gets the same scrubbed reports the maintainers would. [`ERROR_REPORTING_MAINTAINERS_DSN`](../installation/environment-variables.md#error-reporting) holds the maintainers' project; set it empty to make sharing with the maintainers unavailable on your server.
