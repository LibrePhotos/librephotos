---
title: "🪟 Windows standalone (no Docker)"
description: "One folder with librephotos.exe: the server, the frontend and the machine learning models, without Docker or Python."
sidebar_position: 5
---

:::tip Download
[**librephotos-windows-x64.zip**](https://github.com/LibrePhotos/librephotos/releases/latest/download/librephotos-windows-x64.zip)
from the latest release (64-bit Windows). Every release since 1.2.0 carries it under
**Assets** on the [releases page](https://github.com/LibrePhotos/librephotos/releases).
:::

## What it is

A single folder, `librephotos\`, holding `librephotos.exe` and everything it needs: the API server,
the web frontend, the job workers, every machine learning sidecar, ExifTool and ffmpeg. The backend
is compiled with [Nuitka](https://nuitka.net/), so no Python, Docker or database server has to be
installed. The database is SQLite, the same setup as the [single container deployment](unified-deployment.md)
with its internal database.

It is meant for one person's library on their own PC. For a shared server, or for PostgreSQL, use one
of the Docker deployments.

## Running it

1. Download `librephotos-windows-x64.zip` (see above) and unzip it anywhere, for example `C:\Program Files\LibrePhotos` or a
   folder in your home directory.
2. Double-click `librephotos.exe`. No window opens: LibrePhotos runs in the background with an icon
   in the notification area (the tray, bottom right), and after the first migrations your browser
   opens `http://localhost:8000/`. Windows 11 may put a new icon behind the **^** arrow next to the
   clock; drag it onto the taskbar to keep it in view.
3. Create the admin account on the first-time setup screen, then set the scan directory of your user
   (Admin area → Users) to the folder with your photos and start a scan.

The models for face recognition, tagging, captions and semantic search are downloaded on the first
scan, into the data directory below; that needs an internet connection once.

Right-click the tray icon for **Open LibrePhotos** (also a plain click), **Open data folder**,
**Open logs** and **Quit LibrePhotos**. Quitting stops everything: the workers and the machine
learning processes are children of `librephotos.exe` and go down with it, also when it is ended
from Task Manager. If it cannot start, a message box says why: for example that another program
already uses port 8000 (see [Using another port](#using-another-port)).

Not released yet: the icon appears right after the double-click. While LibrePhotos starts, the
first, greyed line of its menu and its tooltip say what it is doing: **Starting...**, **Updating
the database (3 of 7)** after an update with database changes, **Starting services...**, and
finally **Running at http://127.0.0.1:8000/**. The first start after such an update also shows a
notification, because updating the database can take a few minutes. **Quit LibrePhotos** works
during the start too.

Only one LibrePhotos runs per data folder. Starting it a second time, also while the first one is
still starting, shows the notification "LibrePhotos is already starting" and then opens the browser
on the running one; nothing else happens. Up to 1.3.0 a second start during the first one's database
update started a second copy, which could show an error and stop the first copy's background
services.

Started from a terminal instead, it prints its log there and Ctrl-C stops it; `--no-tray` leaves the
icon out. Without a terminal that output goes to `console.log` in the logs folder; the log of the
start before is kept as `console.previous.log` next to it (not released yet), so a failed start can
still be explained after you tried again. Because
`librephotos.exe` is a Windows GUI program, `cmd` and PowerShell do not wait for it: for commands
whose output you want to read in order, use `start /wait librephotos.exe manage ...` in `cmd`, or pipe
it (`librephotos.exe manage ... | more`).

### What the processes are

LibrePhotos runs as a handful of processes, each under its own name in Task Manager's **Details**
tab, `tasklist` and Resource Monitor, so you can see which part is busy:

| Process | What it does |
|---|---|
| `librephotos.exe` | The one you started: web server and API. Closing it stops all the others. |
| `librephotos-jobs.exe` | Runs the background job queue (scans, thumbnails, machine learning jobs). |
| `librephotos-worker.exe` | The job queue's workers and helpers; two workers by default. |
| `librephotos-thumbnails.exe` | Thumbnails for RAW photos. |
| `librephotos-metadata.exe` | Reads and writes EXIF/XMP metadata (ExifTool). |
| `librephotos-faces.exe` | Face detection and recognition. |
| `librephotos-search.exe` | Image and text embeddings for semantic search. |
| `librephotos-similarity.exe` | The similar-photos index. |
| `librephotos-tags.exe` | Automatic tags. |
| `librephotos-captions.exe` | Image captions. |
| `librephotos-ocr.exe` | Text recognition, once an OCR model is selected. |

The extra names are hard links to `librephotos.exe` that are created next to it on the first start;
they take no additional disk space. If the folder is read-only they cannot be created, and every
process simply shows up as `librephotos.exe`. The machine learning processes only listen on
`127.0.0.1`.

### Where things go

| What | Where |
|---|---|
| Database, thumbnails, models, logs | `%LOCALAPPDATA%\LibrePhotos` (`--data-dir` to move it) |
| Database backups made before an update | `%LOCALAPPDATA%\LibrePhotos\db\backups` (not released yet; see [Upgrading](upgrading.md#sqlite-backups)) |
| Photos | Stay where they are; scan directories may be anywhere under your home directory (`--photos` to allow another top directory, e.g. `--photos D:\`) |

### Options

```
librephotos.exe --help
librephotos.exe run --port 8080 --no-browser
librephotos.exe --data-dir D:\LibrePhotos --photos D:\Pictures
librephotos.exe manage createadmin -u admin admin@example.com
librephotos.exe manage <any manage.py command>
```

Two background workers run the scan, thumbnail and machine learning jobs. That suits a single-user PC;
set `WORKER_CONCURRENCY` before starting `librephotos.exe` to use more (each worker is a full copy of
the backend, a few hundred MB of RAM).

The [environment variables](environment-variables.md) of the Docker images work too, set in the
console before starting `librephotos.exe`; the data directory options above only fill in `BASE_DATA`,
`BASE_LOGS` and `PHOTOS` when they are not set. A default `SECRET_KEY` is generated and kept in
`protected_media\secret.key` in the data directory (releases after 1.3.0; 1.3.0 and older kept it in
the logs directory, and a newer release moves it on its first start).

### Using another port

LibrePhotos shows its pages on port 8000. If another program already uses that port (a development
server, another self-hosted tool), LibrePhotos does not start, and a message box names that program
and its process ID. Not released yet: up to 1.3.0, LibrePhotos started its background processes,
showed the tray icon for a moment and quit without a message. Either close the other program, or
start LibrePhotos on another port:

1. Right-click `librephotos.exe` and choose **Show more options** → **Create shortcut** (on Windows
   10: **Create shortcut** directly).
2. Right-click the new shortcut, choose **Properties**, and add ` run --port 8080` to the end of
   **Target**, after the closing quote:

   ```
   "C:\Program Files\LibrePhotos\librephotos.exe" run --port 8080
   ```

3. Start LibrePhotos with that shortcut from now on. The browser and the tray icon's **Open LibrePhotos**
   then use port 8080.

Any free port above 1024 works. Windows keeps some port ranges for Hyper-V, WSL or Docker; if the
message box says LibrePhotos cannot use the port, pick another one (`netsh interface ipv4 show
excludedportrange protocol=tcp` lists the reserved ranges).

The background services use ports 8002 to 8012 on `127.0.0.1`. If another program holds one of
them, LibrePhotos does not start either, and the message box lists each blocked port with the
program holding it, for example `Port 8010 (exif): python.exe, process ID 4321`. Close that
program, or move the service with its `SIDECAR_PORT_<NAME>` variable (the name in brackets, see
[Environment variables](environment-variables.md#internal-service-address)). Environment
variables do not fit in a shortcut, so start LibrePhotos from a small `.cmd` file next to it
instead, for example `LibrePhotos.cmd`:

```bat
@echo off
set SIDECAR_PORT_EXIF=18010
start "" "%~dp0librephotos.exe"
```

Not released yet: up to 1.3.0, LibrePhotos started anyway, and the service failed for every photo
of the next scan with the reason only in `console.log`.

### Updating

Quit LibrePhotos, unzip the new release over the old folder (or into a new one) and start `librephotos.exe` again. Not released yet: when the new release brings database migrations, it first copies the database into `db\backups` in the data folder, then migrates, so the first start after an update can take a few minutes. If the update goes wrong, [restore that backup](upgrading.md#restore) and start the release named in its file name. An older release refuses to start on a database a newer one has migrated, see [Going back to an older release](upgrading.md#downgrade).

### Upgrading from 1.3.0 or older

Not released yet: up to 1.3.0, LibrePhotos on Windows took the time on your PC's clock for UTC when it
recorded when a photo was added and when it checked whether a file had changed since the last scan.
West of Greenwich (UTC minus some hours, as in the Americas) a normal scan could therefore skip a file
you edited within those hours after a scan, and the places and faces of photos added shortly after an
earlier run were not looked up. Run a full rescan once after the upgrade: on the **Library** page, in
the **Scan Library** section, click the arrow next to **Scan** and choose **Rescan** (or **Rescan All
Photos** in the Ctrl+K command palette). East of Greenwich nothing was missed. Either way, the times
in **Recently added** stay shifted by your UTC offset for photos added before the upgrade.

## Building it yourself

```powershell
cd apps\backend
py -3.11 -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt -r requirements.standalone.txt
.\.venv\Scripts\python scripts\build_standalone.py --zip
```

This builds the frontend (Node 24 and Yarn on PATH; `--skip-frontend` reuses `apps/frontend/dist`),
collects the static files and compiles the backend; Nuitka needs Visual Studio's C++ build tools and
downloads the rest itself. Expect the first build to take well over an hour, later ones are much
faster thanks to Nuitka's cache. The result lands in `apps\backend\build\standalone\librephotos\`.
