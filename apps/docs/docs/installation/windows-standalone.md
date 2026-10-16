---
title: "🪟 Windows standalone (no Docker)"
description: "One folder with librephotos.exe: the server, the frontend and the machine learning models, without Docker or Python. Installing, updating, backing up, restoring and uninstalling, step by step."
sidebar_position: 5
---

:::tip Download
[**librephotos-windows-x64.zip**](https://github.com/LibrePhotos/librephotos/releases/latest/download/librephotos-windows-x64.zip)
from the latest release (64-bit Windows). Every release since 1.2.0 carries it under
**Assets** on the [releases page](https://github.com/LibrePhotos/librephotos/releases).

<Since version="1.4.0" /> The same zip is also there as `librephotos-<version>-windows-x64.zip`, so a
downloaded file says which release it is, next to `SHA256SUMS` to [check your
download](#checking-your-download). A new release becomes the latest one only once its Windows zip
is attached, a few hours after it is published; until then this link gives the previous release.
:::

## What it is

A single folder, `librephotos\`, holding `librephotos.exe` and everything it needs: the API server,
the web frontend, the job workers, every machine learning sidecar, ExifTool and ffmpeg. The backend
is compiled with [Nuitka](https://nuitka.net/), so no Python, Docker or database server has to be
installed. The database is SQLite, the same setup as the [single container deployment](unified-deployment.md)
with its internal database.

It is meant for one person's library on their own PC. For a shared server, or for PostgreSQL, use one
of the Docker deployments.

LibrePhotos keeps two things apart:

- The **program folder**: the `librephotos` folder from the zip, with `librephotos.exe`. An update
  replaces it.
- The **data folder**, `%LOCALAPPDATA%\LibrePhotos`: the database (users, albums, people, settings),
  thumbnails, the machine learning models and the logs. An update keeps it, and every copy of the
  program uses the same one.

Your photos stay in your own folders. LibrePhotos reads them there and never moves them into
either folder.

## Running it {#running-it}

1. Download `librephotos-windows-x64.zip` (see above). It is about 450 MB. To be sure it arrived
   complete, [check it](#checking-your-download).
2. Open your **Downloads** folder, right-click `librephotos-windows-x64.zip` and choose **Extract
   All...**.
3. In the box under **Files will be extracted to this folder**, replace the suggested path with a
   folder in your user folder, for example `C:\Users\<you>\LibrePhotos-app` (with your Windows user
   name instead of `<you>`), and click **Extract**. [Choosing a folder](#choosing-a-folder) says why.
   Windows creates the folder and puts a `librephotos` folder in it.
4. Open `C:\Users\<you>\LibrePhotos-app\librephotos` and double-click `librephotos.exe`. Windows
   may show **Windows protected your PC**, because the program is not signed: click **More info**,
   then **Run anyway**.
5. No window opens: LibrePhotos runs in the background with an icon in the notification area (the
   tray, bottom right), and your browser opens `http://localhost:8000/`. While the first start sets
   up the database, the page says "LibrePhotos is updating" and turns into LibrePhotos by itself
   (not released yet: up to 1.3.0 the browser only opened after the first migrations).
   Windows 11 may put a new icon behind the **^** arrow (**Show hidden icons**) next to the clock;
   drag it from there onto the taskbar to keep it in view.
6. Create the admin account on the first-time setup screen, then set the scan directory of your user
   (Admin area → Users) to the folder with your photos and start a scan.

The models for face recognition, tagging, captions and semantic search are downloaded on the first
scan, into the data folder; that needs an internet connection once.

To start LibrePhotos from the desktop next time, right-click `librephotos.exe` and choose **Show
more options** → **Send to** → **Desktop (create shortcut)** (on Windows 10: **Send to** directly).

Right-click the tray icon for **Open LibrePhotos** (also a plain click), **Open data folder**,
**Open logs** and **Quit LibrePhotos**. Quitting stops everything: the workers and the machine
learning processes are children of `librephotos.exe` and go down with it, also when it is ended
from Task Manager. If it cannot start, a message box usually says why: for example that another
program already uses port 8000 (see [Using another port](#using-another-port)).

Not released yet: the icon appears right after the double-click. While LibrePhotos starts, the
first, greyed line of its menu and its tooltip say what it is doing: **Starting...**, **Updating
the database (3 of 7)** after an update with database changes, **Starting services...**, and
finally **Running at http://127.0.0.1:8000/**. The first start after such an update also shows a
notification, because updating the database can take a few minutes. **Quit LibrePhotos** works
during the start too.

Only one LibrePhotos runs per data folder. Starting it again while it runs just opens the browser
on the running one. Not released yet: a start while the first one is still starting shows the
notification "LibrePhotos is already starting", waits for it and then opens the browser; nothing
else happens. Once the first one shows its start-up page, a second start opens the browser on that
page at once. Up to 1.3.0 a second start during the first one's database update started a second
copy, which could show an error and stop the first copy's background services.

Started from a terminal instead, it prints its log there and Ctrl-C stops it; `--no-tray` leaves the
icon out. Without a terminal that output goes to `console.log` in the logs folder; the log of the
start before is kept as `console.previous.log` next to it (not released yet), so a failed start can
still be explained after you tried again. For commands, see [Running a command](#running-a-command).

### Checking your download {#checking-your-download}

<Since version="1.4.0" /> Every release lists the SHA-256 checksums of its zips in a file called
`SHA256SUMS`, under **Assets** next to the zip. If the checksum of your download is the same, the
file arrived complete and is the one the release build made. It does not say who made the build:
the program is not signed yet.

1. Download `SHA256SUMS` from the same release as the zip, into the same folder (usually
   **Downloads**).
2. Open that folder in File Explorer, click the address bar, type `powershell` and press Enter.
3. Paste these lines into the blue window and press Enter:

   ```powershell
   $zip = "librephotos-windows-x64.zip"
   $line = Select-String -Path SHA256SUMS -SimpleMatch -Pattern "  $zip" | Select-Object -First 1
   (Get-FileHash $zip -Algorithm SHA256).Hash -eq $line.Line.Split(" ")[0]
   ```

   For the zip with the version in its name, put that name in the first line instead.

`True` means the download is fine. `False` means the file is incomplete or not the release's: delete
it and download it again. You can also compare by eye: `Get-FileHash librephotos-windows-x64.zip`
prints the **Hash**, and `SHA256SUMS` (open it with Notepad) has the same value in small letters
in front of the file name.

### Choosing a folder {#choosing-a-folder}

Put the program folder in your own user folder, for example `C:\Users\<you>\LibrePhotos-app`.
Windows lets you change files there without administrator rights, so an update is just unzipping,
and LibrePhotos can create the extra process names it needs next to `librephotos.exe` (see [What
the processes are](#what-the-processes-are)).

Avoid these places:

- `C:\Program Files`: unzipping there, and every update after it, needs administrator rights, and
  every process shows up as `librephotos.exe`.
- The Desktop, Documents, or another folder OneDrive backs up: the program files then sync to the
  cloud.
- The folder **Extract All...** suggests, `Downloads\librephotos-windows-x64`: it works, but it is
  easily deleted when you tidy up Downloads, and you then end up with the program in
  `Downloads\librephotos-windows-x64\librephotos\`.

Whichever folder you choose, the library is the same: the data folder does not depend on where the
program is.

### What the processes are {#what-the-processes-are}

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
| `librephotos-similarity.exe` | The similar-photos index. |
| `librephotos-tags.exe` | Automatic tags, and the image and text embeddings for semantic search. |
| `librephotos-captions.exe` | Image captions. |
| `librephotos-ocr.exe` | Text recognition, once an OCR model is selected. |

The extra names are hard links to `librephotos.exe` that are created next to it on the first start;
they take no additional disk space. If the folder is read-only they cannot be created, and every
process simply shows up as `librephotos.exe`. The machine learning processes only listen on
`127.0.0.1`.

### Where things go {#where-things-go}

| What | Where |
|---|---|
| Database | `db` in the data folder, `%LOCALAPPDATA%\LibrePhotos\db` (`--data-dir` to move the whole data folder) |
| Database backups made before an update | `%LOCALAPPDATA%\LibrePhotos\db\backups` (not released yet; see [Upgrading](upgrading.md#sqlite-backups)) |
| Secret key | `%LOCALAPPDATA%\LibrePhotos\protected_media\secret.key` (1.3.0 and older: `logs\secret.key`, see below) |
| Thumbnails, profile pictures, machine learning models | `%LOCALAPPDATA%\LibrePhotos\protected_media` |
| Logs | `%LOCALAPPDATA%\LibrePhotos\logs` (tray: **Open logs**) |
| Photos | Stay where they are; scan directories may be anywhere under your home directory (`--photos` to allow another top directory, e.g. `--photos D:\`) |

To open the data folder, choose **Open data folder** in the tray menu, or type
`%LOCALAPPDATA%\LibrePhotos` into the address bar of File Explorer and press Enter.

### Options

```
librephotos.exe --help
librephotos.exe run --port 8080 --no-browser
librephotos.exe --data-dir D:\LibrePhotos --photos D:\Pictures
librephotos.exe --data-dir D:\LibrePhotos run --port 8080
librephotos.exe manage createadmin -u admin admin@example.com
librephotos.exe manage <any manage.py command>
```

`--data-dir` and `--photos` belong to `librephotos.exe` itself, so they come before `run` or
`manage`: `librephotos.exe run --data-dir D:\LibrePhotos` is refused, and after `manage` they are
handed to the command, which does not know them.

Two background workers run the scan, thumbnail and machine learning jobs. That suits a single-user PC;
set `WORKER_CONCURRENCY` before starting `librephotos.exe` to use more (each worker is a full copy of
the backend, a few hundred MB of RAM).

The [environment variables](environment-variables.md) of the Docker images work too, set in the
console before starting `librephotos.exe`; the data directory options above only fill in `BASE_DATA`,
`BASE_LOGS` and `PHOTOS` when they are not set. A default `SECRET_KEY` is generated and kept in
`protected_media\secret.key` in the data directory (releases after 1.3.0; 1.3.0 and older kept it in
the logs directory, and a newer release moves it on its first start).

### Running a command {#running-a-command}

Some release notes ask you to run a command once after an update. `librephotos.exe` is a Windows
program without a window of its own, so `cmd` and PowerShell do not wait for it; `start /wait` makes
`cmd` wait and keeps the output in order:

1. Start the new release once, as usual, so that it updates the database. It may keep running
   while the command runs.
2. Press **Windows key + R**, type `cmd` and press Enter.
3. Go to the program folder (the quotes matter if the path has spaces):

   ```bat
   cd /d "C:\Users\<you>\LibrePhotos-app\librephotos"
   ```

4. Run the command, for example the thumbnail cleanup from [Upgrading](upgrading.md#strip-thumbnail-metadata):

   ```bat
   start /wait librephotos.exe manage strip_thumbnail_metadata
   ```

   With another data folder, put `--data-dir` before `manage`:

   ```bat
   start /wait librephotos.exe --data-dir D:\LibrePhotos manage strip_thumbnail_metadata
   ```

Piping works as well: `librephotos.exe manage strip_thumbnail_metadata | more`.

### Using another port {#using-another-port}

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
   "C:\Users\<you>\LibrePhotos-app\librephotos\librephotos.exe" run --port 8080
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

## Updating {#updating}

An update replaces the program folder and keeps the data folder: your photos, albums, people, users
and settings are all still there afterwards. The steps assume the program is in
`C:\Users\<you>\LibrePhotos-app\librephotos`; use your own folder if it is somewhere else.

1. [Back up](#backing-up) the database. The new release also makes a copy of the database itself
   before it changes it (not released yet, see below), but a copy on another drive is the safe way
   back.
2. Quit LibrePhotos: right-click its icon in the tray (behind the **^** arrow if you do not see it)
   and choose **Quit LibrePhotos**. Wait until the icon disappears, which takes a few seconds.
3. Download the new `librephotos-windows-x64.zip` from the [releases
   page](https://github.com/LibrePhotos/librephotos/releases), and read that release's notes: some
   ask you to do something once after the update.
4. In File Explorer, open `C:\Users\<you>\LibrePhotos-app`, right-click the `librephotos` folder,
   choose **Rename** and call it `librephotos-old`. If Windows says the folder is in use,
   LibrePhotos is still running: wait a moment and try again, or end `librephotos.exe` in Task
   Manager.

   Do not unzip the new release over the old folder instead. Files that are still in use cannot be
   replaced, and files the new release no longer has stay behind, so the folder can end up with a
   mix of both releases. The old folder is also your way back.
5. Right-click the new zip, choose **Extract All...**, and extract it into
   `C:\Users\<you>\LibrePhotos-app` again. You now have a new `librephotos` folder next to
   `librephotos-old`. Shortcuts to `librephotos\librephotos.exe` keep working.
6. Double-click `librephotos.exe` in the new `librephotos` folder, once. If the release brings
   database changes, the first start updates the database, and the browser shows "LibrePhotos is
   updating" meanwhile ([what the page says](upgrading.md#updating-screen)). That can take a few
   minutes with a large library: wait, and do not start it again meanwhile.
7. Check that LibrePhotos works: log in and open a few photos and albums. Then delete the
   `librephotos-old` folder. Keep it for a while if you might want to [go back](#going-back).

What the first start after an update does, not released yet (up to 1.3.0 it only updates the
database, and nothing shows until the browser opens):

- It copies the database into `db\backups` in the data folder before it changes anything. The copy
  is named after the new release and the time, and holds the database as the old release left it.
  The three newest copies are kept. If there is not
  enough free disk space for the copy, LibrePhotos does not start, and a message box says how much
  space to free. See [Automatic backups](upgrading.md#sqlite-backups).
- The tray icon says **Updating the database (3 of 7)** while it works, and a notification says
  that the database is being updated.
- After an update from 1.3.0 or older, it moves the secret key from `logs\secret.key` to
  `protected_media\secret.key`.

If the new release does not start, the message box says why, and `console.log` in the logs folder
(tray: **Open logs**) has the details. You can always [go back](#going-back) to the old release.

### Upgrading from 1.3.0 or older

Not released yet: up to 1.3.0, LibrePhotos on Windows took the time on your PC's clock for UTC when it
recorded when a photo was added and when it checked whether a file had changed since the last scan.
West of Greenwich (UTC minus some hours, as in the Americas) a normal scan could therefore skip a file
you edited within those hours after a scan, and the places and faces of photos added shortly after an
earlier run were not looked up. Run a full rescan once after the upgrade: on the **Library** page, in
the **Scan Library** section, click the arrow next to **Scan** and choose **Rescan** (or **Rescan All
Photos** in the Ctrl+K command palette). East of Greenwich nothing was missed. Either way, the times
in **Recently added** stay shifted by your UTC offset for photos added before the upgrade.

## Backing up and restoring {#backing-up}

The most complete backup is a copy of the whole data folder, `%LOCALAPPDATA%\LibrePhotos`. It can
be many GB, mostly thumbnails and machine learning models, which LibrePhotos makes again by a
rescan or downloads again. If that is too much, back up at least these two, which nothing can make
again:

| What | Why |
|---|---|
| The `db` folder | The database: users, albums, people and face names, favourites, ratings, captions, settings. |
| `protected_media\secret.key` (1.3.0 and older: `logs\secret.key`) | Encrypts the saved email server password and Nextcloud app passwords, and signs every login. Without it, everyone has to log in again and those passwords have to be entered again. |

Two small folders in `protected_media` are worth copying too: `faces` (the face pictures shown
under People) and `avatars` (profile pictures).

### Making a backup

1. Right-click the LibrePhotos icon in the tray and choose **Open data folder**. (Without the icon:
   type `%LOCALAPPDATA%\LibrePhotos` into the address bar of File Explorer and press Enter.)
2. Right-click the icon again and choose **Quit LibrePhotos**. Wait until it disappears: a copy of
   the database made while LibrePhotos runs can be incomplete.
3. Copy the `db` folder, with everything in it, to a safe place, for example an external drive:
   right-click `db`, choose **Copy**, open the target folder and press Ctrl+V. If there are files
   named `librephotos.sqlite3-wal` or `librephotos.sqlite3-shm` in it, they belong to the database
   and have to be copied too.
4. Open `protected_media` and copy `secret.key` to the same safe place, and the `faces` and
   `avatars` folders if you want them. With 1.3.0 or older, `secret.key` is in `logs` instead.
5. Start LibrePhotos again.

For the complete backup, copy the whole `LibrePhotos` folder in step 3 instead, and skip step 4.

The automatic copies in `db\backups` (not released yet) are made on the same drive as the database,
so they help after a failed update, but not when the drive fails. See [Automatic
backups](upgrading.md#sqlite-backups).

### Restoring a backup {#restoring}

1. Quit LibrePhotos (tray: **Quit LibrePhotos**).
2. Open the data folder (`%LOCALAPPDATA%\LibrePhotos`) and rename the `db` folder to `db-broken`.
3. Copy the `db` folder from your backup into the data folder.
4. Copy `secret.key` from your backup into `protected_media`, replacing the one there, and the
   `faces` and `avatars` folders if you backed them up. When you go back to 1.3.0 or older, copy
   `secret.key` into `logs` instead, as `logs\secret.key`: those releases look for it there.
5. Start the release you made the backup with (or a newer one, which updates the database again).
   Releases after 1.3.0 refuse to start on a database a newer release has updated, see [Going back
   to an older release](upgrading.md#downgrade).
6. When everything works, delete `db-broken`.

To restore a complete backup, quit LibrePhotos, rename the `LibrePhotos` data folder to
`LibrePhotos-broken`, and copy your backup in its place.

To restore one of the automatic copies from `db\backups` instead, see [Restoring a
backup](upgrading.md#restore) on the Upgrading page.

### Going back to the previous release {#going-back}

1. Quit LibrePhotos.
2. In `C:\Users\<you>\LibrePhotos-app`, rename the new `librephotos` folder to `librephotos-new`,
   and `librephotos-old` back to `librephotos`.
3. If the new release updated the database, put the database from before the update back:
   [your own backup](#restoring), or the newest automatic copy in `db\backups`, the one named after
   the new release ([Restoring a backup](upgrading.md#restore)). An older release cannot run on the database a
   newer one has updated: releases after 1.3.0 refuse to start and say so, 1.3.0 and older start
   but fail later.
4. When you go back to 1.3.0 or older and the new release moved the secret key, copy
   `protected_media\secret.key` to `logs\secret.key`.
5. Start `librephotos.exe` in the `librephotos` folder.

Changes made with the newer release (faces named, albums edited) are not in the old database. The
next scan finds photos added since.

## Uninstalling {#uninstalling}

The zip installs nothing outside its folder: no Start menu entry, no service and no registry
settings. To remove LibrePhotos:

1. Quit LibrePhotos (tray: **Quit LibrePhotos**).
2. Delete the program folder, for example `C:\Users\<you>\LibrePhotos-app` (with `librephotos`
   and any `librephotos-old` in it), and the shortcuts you made to it.
3. Only if you do not want to keep your library: delete the data folder, `%LOCALAPPDATA%\LibrePhotos`
   (or the folder you gave with `--data-dir`). It holds the database, thumbnails, models and logs
   and can be many GB. [Back it up](#backing-up) first if you might want your albums, people and
   settings back: if you keep it, a later install picks up the library where you left it.

Your photos in your own folders are not touched by any of this.

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
With `--zip`, the zip and `SHA256SUMS` are next to that folder.

To check a build the way the release workflow does, run the zip on a fresh data folder: the script
starts it on free ports, creates an admin, checks every background service that needs no model,
scans three sample photos, then ends `librephotos.exe` and fails if any of its processes is left.

```powershell
.\.venv\Scripts\python scripts\smoke_standalone.py build\standalone\librephotos-windows-x64.zip
```
