---
title: "🤖 Auto scan all folders"
description: "Scan every library automatically, on a schedule set in Site settings or from a cron job on the host, or let a folder watcher name the new files"
sidebar_position: 12
---

## Auto scan all folders

LibrePhotos can scan every library by itself, so new photos show up without anyone clicking **Scan**. Admins set the schedule in the app ([below](#scan-on-a-schedule)); a cron job on the host [still works too](#with-a-cron-job-on-the-host).

## Scan on a schedule

<Since version="1.4.0" />

Open **Account menu > Admin Area > Site settings** and pick a schedule under **Scan libraries automatically**:

- **Off** (the default): nothing is scanned unless a user clicks **Scan** on the Library page.
- **Every hour**: at the start of every hour.
- **Every day**, at the time you enter.
- **Custom**: on the days you pick, at the time you enter. With no day picked, nothing is saved and the schedule you had stays.

The setting is saved as you change it, like the other site settings. Nothing needs a restart.

### What a run does

Each run starts, for every user with a scan directory, the same scan the **Scan** button on the Library page starts: an incremental scan of their scan directory, followed by the usual face detection, things and places. While the [Nextcloud integration](./library.md#nextcloud-integration) is on, a user's Nextcloud folder is scanned too, right after their scan directory. The scans show up in the job list like any other **Scan Photos** job, started by the user whose library they scan.

A run never stacks a scan on top of another one. A user whose scan is still queued or running, from the previous run or from a click on **Scan**, is skipped this time and picked up by the next run. This is what keeps a long first scan of a big library from being started again every hour.

A user whose scan directory does not exist, or whose Nextcloud address is not allowed, is counted as failed for that run, and no job is started for them.

### Times and time zones

The time you enter is in the server's time zone, which the row names. The Docker images run on UTC, so **Every day** at `03:00` is 03:00 UTC: 05:00 in Berlin in summer, 23:00 the evening before in New York. The status line shows the next run in your own time zone, so you can check what you set.

A **Custom** run that had to wait in a busy queue past midnight still counts as a run for the day it was due.

### The status line

Under the setting, one line says what the last run did and when the next one is, for example:

- _Last run Oct 14, 2026, 3:00 AM: 3 libraries scanned. Next run Oct 15, 2026, 3:00 AM._
- _Still scanning: anna._ The scans of that run are queued or running.
- _Skipped bob: a scan was still running._
- _Could not scan carla; see Worker Logs._ Her library could not be scanned, or her scan failed. The job in **Worker Logs** says why, for example that the scan directory looks unmounted (see [Missing Photos](./missing-photos.md#when-a-scan-asks-is-the-library-mounted)).

### Why a scan every hour is cheap

An incremental scan only reads files that are new or changed since a scan last read them. A file LibrePhotos wrote metadata into itself does not count as changed (see [How a rescan treats your edits](./exif-data.md#how-a-rescan-treats-your-edits)). On a library where nothing changed, a run walks the folders, compares each file's modification time with the one it recorded, and finishes.

Only a scan that went through the whole library is what the next scan compares against. A scan that was cancelled, failed, or covered only some files (an upload, a single folder) is not, so the next scheduled scan also picks up what that one never got to.

A scan that stops making progress, for example because a worker died, is marked failed after a while ([`STUCK_JOB_HOURS`](../installation/environment-variables.md#stuck-jobs), 24 hours by default) and no longer counts as running, so the schedule picks that library up again. A long scan that is still making progress is left alone.

## Tell LibrePhotos about new files

<Since version="1.4.0" />

A scheduled scan walks every folder. When something outside LibrePhotos already knows which files are new, such as a sync tool, a camera upload script or a folder watcher, it can name them instead, and they show up within seconds of the call:

```bash
curl -u myuser:mypassword -H 'Content-Type: application/json'   -d '{"paths": ["/data/2026/10/IMG_2041.jpg", "/data/2026/10/IMG_2041.CR3"]}'   "http://localhost:3000/api/scan-files/"
```

`POST /api/scan-files/` takes up to 1,000 paths, **as LibrePhotos sees them** (inside the container that is the scan directory set for your user, such as `/data/...`, not the folder on the host). It authenticates like every other endpoint, with your user's password over Basic auth or a JWT access token (see [API authentication](./api-authentication.md)); a script that runs for days is simpler with Basic auth, because an access token expires after 5 minutes. Use HTTPS, or call it from the same machine.

The call starts a **Scan Photos** job for those files and answers at once:

```json
{"status": true, "job_id": "…", "job_ids": ["…"], "file_count": 2, "ignored_paths": []}
```

- A file is read when it is new or changed, as on a **Scan**. Its things, places and faces follow as after any scan. A file that was deleted is not removed: the next scan of the whole library notices that (see [Missing Photos](./missing-photos.md)).
- Only existing files inside your scan directory or upload folder are scanned. Folders, files that do not exist and anything outside your library are listed in `ignored_paths`. When nothing is left, the answer is a 400 with the code `no_files_to_scan`.
- While a scan of yours runs, the answer is a 409 (`job_already_running`) with that job's `job_id`. Nothing is queued then: send the paths again later. The next scheduled scan picks the files up too.
- Such a scan never counts as the scan of the whole library that the next **Scan** compares against, so it cannot make a later scan miss a file.

### A folder watcher

This script watches the library on the host with `inotifywait` (package `inotify-tools`, plus `curl` and `jq`), collects what changed, and sends it once nothing has changed for 30 seconds, so a burst of uploads is one call. A batch is kept while a scan runs (409) and sent again with the next one.

```bash
#!/usr/bin/env bash
# The library on the host, and the same folder as LibrePhotos sees it.
HOST_ROOT=/srv/photos
LP_ROOT=/data
URL=http://localhost:3000/api/scan-files/
# LP_USER and LP_PASSWORD come from the environment.

batch=()
inotifywait -m -r -q -e close_write -e moved_to --format '%w%f' "$HOST_ROOT" |
  while true; do
    if read -r -t 30 path; then
      batch+=("$LP_ROOT${path#"$HOST_ROOT"}")
      [ ${#batch[@]} -lt 1000 ] && continue
    fi
    [ ${#batch[@]} -eq 0 ] && continue
    body=$(printf '%s
' "${batch[@]}" | jq -R . | jq -s '{paths: .}')
    status=$(curl -s -o /dev/null -w '%{http_code}' -u "$LP_USER:$LP_PASSWORD"       -H 'Content-Type: application/json' -d "$body" "$URL")
    # 409: a scan is running, keep the batch for the next try.
    [ "$status" != 409 ] && batch=()
  done
```

Run it as a systemd service or in `screen`. To keep a quiet library from being called every 30 seconds, the script only sends when it has something.

## With a cron job on the host

You can also start a scan from the host, for example when you want a different schedule per user or already manage your jobs with cron:

```
sudo docker exec --user root backend python3 manage.py scan
```

`backend` is the default container name set by `container_name:` in `docker-compose.yml`; substitute your own if you changed it (see [Changing the container names](../installation/environment-variables.md#changing-the-container-names)).

The plain `scan` command is incremental too. Use `scan -f` to force a full re-process of every file, or `scan -s /path/a.jpg /path/b.jpg` to scan specific files. See [Management Commands](./library.md#management-commands) for the full list.

:::note Nextcloud users
`manage.py scan` only scans the local scan directory. To scan a connected [Nextcloud library](./library.md#nextcloud-integration) from the command line, run `manage.py scan -n`, and cron it separately.
:::

A cron entry that calls this command regularly:

```
# Every day at 3 AM
0 3 * * * sudo docker exec --user root backend python3 manage.py scan >/dev/null 2>&1
```

Unlike the schedule in Site settings, the command scans every library in turn while you wait and does not check whether a scan is already running, so keep the interval longer than a scan takes. Use one or the other, not both.
