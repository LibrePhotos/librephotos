---
title: "Mac app (no Docker)"
description: "LibrePhotos Server as a Mac app for Apple silicon: a disk image with the server, the frontend and the machine learning services, a menu bar icon and the built-in updater. Installing, updating, backing up and uninstalling, step by step."
sidebar_position: 6
---

:::tip Download
<Since version="1.7.0" /> [**LibrePhotos-Server-macos-arm64.dmg**](https://github.com/LibrePhotos/librephotos/releases/latest/download/LibrePhotos-Server-macos-arm64.dmg)
from the latest release, for Macs with Apple silicon (M1 and newer) on macOS 14 Sonoma or newer.
Every release also carries it as `LibrePhotos-Server-<version>-macos-arm64.dmg`, the zip the
built-in updater downloads (`librephotos-macos-arm64.zip`) and `SHA256SUMS-macos-arm64` to [check
your download](#checking-your-download).
:::

:::warning Not notarized yet
The project has no Apple Developer ID yet, so the app is signed ad hoc, not by a known developer,
and macOS refuses to open a downloaded copy at first. [Opening it the first time](#first-start)
shows how to allow it once. As soon as the releases are signed and notarized by Apple, the app
opens like any other and this note goes away.
:::

## What it is

`LibrePhotos Server.app` is the same program as the [Windows app](windows-standalone.md): the API
server, the web frontend, the job workers, every machine learning service, ExifTool and ffmpeg,
compiled with [Nuitka](https://nuitka.net/), so no Python, Docker or database server has to be
installed. The database is SQLite, as in the [single container deployment](unified-deployment.md).
You use LibrePhotos in your browser at `http://localhost:8000/`; the app itself is an icon in the
menu bar and has no window and no Dock icon.

It is a server: other devices on your network, such as the [mobile app](../user-guide/index.md), can
use it too once you [let them in](#other-devices). If you only want to browse a LibrePhotos server
that runs elsewhere, the LibrePhotos Viewer is the app for that.

ExifTool runs on the Perl that macOS ships. ffmpeg is LibrePhotos' own minimal build, licensed
under the GPL (version 2 or later), the same build the [Windows app](windows-standalone.md) has.

## Installing {#installing}

1. Download `LibrePhotos-Server-macos-arm64.dmg` and open it.
2. Drag **LibrePhotos Server** onto the **Applications** folder in the window that opens.
3. Eject the disk image (the eject button next to **LibrePhotos Server** in the Finder sidebar).
4. Open **LibrePhotos Server** from Applications or Launchpad. The first time, see [Opening it the
   first time](#first-start).

The app lives in `/Applications`. If you are not an administrator of your Mac, drag it into the
`Applications` folder in your home folder (`~/Applications`) instead: the built-in updater needs to
write next to the app, which a standard user cannot do in `/Applications`.

### Opening it the first time {#first-start}

While the releases are not notarized, macOS says it cannot check the app for malicious software.

1. Open the app once and click **Done** in the message.
2. Open **System Settings > Privacy & Security**, scroll to **Security** and click **Open Anyway**
   next to the line about **LibrePhotos Server**.
3. Open the app again and click **Open Anyway**, then enter your password.

macOS remembers this choice. Updates through the [built-in updater](#update-from-the-app) do not ask
again.

### With Homebrew {#homebrew}

The repository has a Homebrew cask, `deploy/homebrew/librephotos-server.rb`. It installs the disk
image into `/Applications`, and `brew uninstall --cask librephotos-server` removes the app, its older
copy and the login item, while `--zap` also deletes the library. It is published in a tap once the
releases are notarized; Homebrew does not accept casks for apps that Gatekeeper blocks. The cask
says `auto_updates true`: the app [updates itself](#update-from-the-app), and `brew upgrade` leaves it
alone.

## Running it {#running-it}

Opening **LibrePhotos Server** starts the server and opens `http://localhost:8000/` in your
browser. The first start sets up the database, which takes a minute or two; the page says so and
reloads once LibrePhotos is ready. Then:

1. Create the admin account on the first-time setup screen.
2. Set the scan directory of your user (**Admin area > Users**) to the folder with your photos, for
   example `/Users/<you>/Pictures`, and start a scan. The machine learning models are downloaded on
   the first scan, into the data folder.

The menu bar icon (the LibrePhotos logo, top right) has everything else: the status (greyed out),
**Open LibrePhotos**, **Check for updates** and the update items, **Open data folder**, **Open
logs**, **Open at Login** and **Quit LibrePhotos**. Quitting stops the server, the workers and every
service; so does logging out.

The services that need no model choice run from the start, as on Windows: metadata (ExifTool),
thumbnails, similar photos and the tags, search and similarity model. Faces, captions and text
recognition start once you switch them on in the **Admin area**.

### Privacy prompts {#privacy-prompts}

macOS asks before an app reads your Desktop, Documents and Downloads folders, external drives or
network drives. When a scan directory is in one of them, the first scan makes macOS ask whether
**LibrePhotos Server** may access it; click **Allow**. You can change it later in **System Settings >
Privacy & Security > Files and Folders**. A scan directory elsewhere, such as `~/Pictures`, needs no
prompt.

### Other devices {#other-devices}

LibrePhotos only answers on this Mac (`127.0.0.1`) unless you start it with another address, which
is what the phone app needs:

```bash
"/Applications/LibrePhotos Server.app/Contents/MacOS/LibrePhotos Server" run --host 0.0.0.0
```

macOS then asks whether **LibrePhotos Server** may accept incoming network connections. Other
devices reach it at `http://<your-mac-name>.local:8000/`.

### Where things go {#where-things-go}

| What | Where |
| --- | --- |
| The app | `/Applications/LibrePhotos Server.app` |
| The database, thumbnails, models, secret key | `~/Library/Application Support/LibrePhotos` |
| Logs (`console.log`, `update.log`, ...) | `~/Library/Application Support/LibrePhotos/logs` |
| Open at Login | `~/Library/LaunchAgents/com.librephotos.server.plist` |
| Your photos | where they are; LibrePhotos only reads them |

The app never writes into its own bundle, so its code signature stays valid. `--data-dir` chooses
another data folder, for example on an external drive (see [Running a command](#running-a-command)).

### Open at Login {#open-at-login}

Off unless you turn it on: choose **Open at Login** in the menu bar menu, or run

```bash
"/Applications/LibrePhotos Server.app/Contents/MacOS/LibrePhotos Server" start-at-login on
```

(`off` turns it off, `status` says which). LibrePhotos then starts without opening the browser when
you log in. It is a launch agent, `~/Library/LaunchAgents/com.librephotos.server.plist`, which macOS
lists under **System Settings > General > Login Items & Extensions** as **LibrePhotos Server**; it
starts the app with the data folder it runs with.

### Running a command {#running-a-command}

The program inside the app takes the same options as `librephotos.exe` on Windows:

```bash
cd "/Applications/LibrePhotos Server.app/Contents/MacOS"
./"LibrePhotos Server" --help
./"LibrePhotos Server" manage createadmin admin admin@example.com
./"LibrePhotos Server" --data-dir "/Volumes/Photos/LibrePhotos" run
```

Quit the app from the menu bar first when you start it by hand, or use another data folder.
`manage <command>` runs any `manage.py` command against the same data folder; options such as
`--data-dir` come before `manage`.

### Using another port {#using-another-port}

When another program uses port 8000, LibrePhotos says so and does not start. Start it on another
port:

```bash
"/Applications/LibrePhotos Server.app/Contents/MacOS/LibrePhotos Server" run --port 8080
```

The services have ports of their own on this Mac, from 8001 up; the `SIDECAR_PORT_*` variables in
[Environment variables](environment-variables.md) move them.

## Updating {#updating}

An update replaces the app and keeps the data folder: your photos, albums, people, users and
settings are all still there afterwards.

### Updating from LibrePhotos {#update-from-the-app}

When a newer release is out, the **Admin area** shows an **Update available** card and the menu bar
menu an update item.

1. Click **Download update** on the card, or choose **Download LibrePhotos 1.8.0** in the menu bar
   menu. LibrePhotos downloads the release from GitHub while it keeps running and checks it against
   the release's `SHA256SUMS-macos-arm64`.
2. When it is ready, click **Restart to update** (or choose it in the menu). If a job such as a scan
   runs, LibrePhotos asks first.
3. LibrePhotos quits, puts the new app in place and opens it again. The browser page reloads by
   itself once the new release answers.

What happens next to the app (in `/Applications`, or wherever you put it):

- The download goes into `LibrePhotos Server.app-1.8.0.partial` and is unpacked into
  `LibrePhotos Server.app-1.8.0`, with a small `LibrePhotos Server.app-1.8.0.librephotos-update.json`
  next to it that says it was checked. Neither is an app to macOS, so neither shows up in Launchpad.
- On **Restart to update**, `LibrePhotos Server.app` is renamed to `LibrePhotos Server.app-old` and
  the new copy to `LibrePhotos Server.app`. The Dock, Launchpad and the login item keep starting
  the same path.
- `LibrePhotos Server.app-old` stays as the way [back to the previous release](#going-back). The one
  from the update before is deleted once the new release answers, but only when it holds nothing
  but that release. Each update writes `update.log` in the logs folder.

The update is not possible, and the card links these steps instead, when LibrePhotos cannot write
next to the app (a standard user and `/Applications`), or when the data folder or a photo folder is
inside the app.

### Updating by hand {#update-by-hand}

1. Quit LibrePhotos (menu bar: **Quit LibrePhotos**).
2. Download the new disk image and drag **LibrePhotos Server** onto **Applications** again; choose
   **Replace**.
3. Open it. A release that updates the database backs it up into `db/backups` in the data folder
   first.

### Going back to the previous release {#going-back}

1. Quit LibrePhotos.
2. In `/Applications`, rename `LibrePhotos Server.app` to `LibrePhotos Server new.app` and
   `LibrePhotos Server.app-old` to `LibrePhotos Server.app`.
3. If the new release updated the database, put the copy from before the update back: the newest
   one in `db/backups` in the data folder, as [Restoring a backup](upgrading.md#restore) shows.
4. Open **LibrePhotos Server**.

## Backing up {#backing-up}

Everything LibrePhotos knows about your library is in `~/Library/Application Support/LibrePhotos`.
Time Machine backs it up with the rest of your home folder. For a copy of your own, quit LibrePhotos
first and copy the whole folder; the `db` folder and `protected_media/secret.key` are the parts you
cannot get back by scanning again.

## Uninstalling {#uninstalling}

The app has an uninstaller that quits LibrePhotos, removes the app, its older copies next to it and
the login item, and keeps your library:

```bash
"/Applications/LibrePhotos Server.app/Contents/Resources/uninstall.sh"
```

Add `--delete-data` to delete the library in `~/Library/Application Support/LibrePhotos` too. By
hand:

1. Quit LibrePhotos (menu bar: **Quit LibrePhotos**).
2. Turn off **Open at Login** if it is on, or delete
   `~/Library/LaunchAgents/com.librephotos.server.plist`.
3. Move `LibrePhotos Server.app` and `LibrePhotos Server.app-old` from Applications to the Trash.
4. Only if you do not want to keep your library: move `~/Library/Application Support/LibrePhotos`
   to the Trash. A later install picks up a library you kept where you left it.

Your photos in your own folders are not touched.

## Checking your download {#checking-your-download}

In Terminal, in the folder with the download and `SHA256SUMS-macos-arm64` from the same release:

```bash
shasum -a 256 -c SHA256SUMS-macos-arm64 --ignore-missing
```

`OK` after the file name means it is the file the release has.

## Coming from Docker {#coming-from-docker}

There is no import from a Docker installation. The standard Docker setup keeps its library in
PostgreSQL, the Mac app in SQLite, and the database stores the photo paths as the container sees
them (`/data/...`), not as your Mac does. You can keep running LibrePhotos in Docker Desktop, or
start with an empty library in the Mac app and scan the same folders again: photos, dates, places,
things and faces come back from the files, but albums, face names, favorites and other edits made
in LibrePhotos do not.

## Intel Macs and the Mac App Store {#limits}

There is no build for Intel Macs: ONNX Runtime, which runs the machine learning models, and the RAW
decoder and cryptography packages LibrePhotos uses no longer publish packages for them.

LibrePhotos Server is not in the Mac App Store, and is not planned to be. Apps there must run in
Apple's sandbox, which only lets an app read folders you pick in its own dialog each time, cannot
update themselves, and may not download the machine learning models after installing. The ffmpeg
build LibrePhotos ships is licensed under the GPL, which the App Store's terms do not allow.

## Building it yourself

See [the developer page](../development/contribution/backend/macos-app.md).
