---
title: "The Windows installer"
description: "How LibrePhotos-Setup.exe is built, where it installs, how the built-in updater and the move from an unzipped copy work with it, and what the Microsoft Store needs."
sidebar_position: 8
---

<Since version="1.7.0" /> The Windows standalone build ([Windows standalone](../../../installation/windows-standalone.md))
ships twice: as the portable zip and as `LibrePhotos-Setup-<version>.exe` (plus `LibrePhotos-Setup.exe`, the
same file under a name the `releases/latest/download` link can use). Both hold the same Nuitka build, and both
are in the release's `SHA256SUMS`.

## Why Inno Setup

| Tool | For LibrePhotos |
|---|---|
| **Inno Setup 6** (chosen) | One offline `.exe`, per-user without UAC (`PrivilegesRequired=lowest`), silent switches, an uninstall entry in `HKCU`, a `SignTool` hook that also signs the uninstaller, Pascal code for the checks below. Preinstalled on GitHub's Windows runners. It changes nothing about how updates work. |
| NSIS | Same reach, but every uninstall entry, shortcut and silent switch is written by hand. |
| WiX / MSI | Per-user MSIs are awkward (`ALLUSERS=2`, `MSIINSTALLPERUSER`), and Windows Installer's own repair and file versioning fight a program folder the app swaps by itself. |
| Velopack | Brings its own updater (#2312): a second update path next to the built-in one, which has the health check and the way back (`librephotos-old`). Its `Update.exe` would also have to escape the job object that ends LibrePhotos' children. |
| MSIX | The server needs its data outside the package (`%LOCALAPPDATA%` writes are redirected and deleted with the package) and services that MSIX rarely allows. Fine for the Viewer, not for the server. |

The built-in updater (#2788) stays the one way installed copies update; the installer only puts the first
copy in place and adds what a zip cannot: a Start menu entry, an optional start at sign-in and an entry in
**Installed apps**.

## Layout

`apps/backend/installer/librephotos.iss` installs into `{userpf}\LibrePhotos`, that is
`%LOCALAPPDATA%\Programs\LibrePhotos`:

| Path | What |
|---|---|
| `librephotos\` | The program folder, exactly the zip's `librephotos` folder |
| `librephotos-old\`, `librephotos-<version>\`, `librephotos-<version>.partial\` | The updater's way back and downloads, next to the program folder as with the zip |
| `unins000.exe`, `unins000.dat` | The uninstaller, outside the program folder |

Because the uninstaller is outside `librephotos\`, the updater's folder swap leaves it valid, and the Start
menu entry, the desktop shortcut, the `HKCU\...\Run` value and the uninstall entry's `DisplayIcon` all name
`{app}\librephotos\librephotos.exe`, which is the new release after a swap. The uninstall entry is
`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\{26C84F48-38D6-462C-8222-E61176B1CF84}_is1`; the
`AppId` must never change, or Windows sees a second app. `librephotos/installation.py` reads it:

- **Layout**: a program folder whose parent is the entry's `InstallLocation` is `installed`, any other is
  `portable` (`GET /api/updates/` says which in `install.layout`).
- **Version**: the installed copy writes its release (`build_info.json`) into `DisplayVersion`,
  `MajorVersion` and `MinorVersion` at every start, before anything else (`sync_installed_version` in
  `librephotos/standalone.py`). So after an update from LibrePhotos, and after going back by renaming
  folders, **Installed apps** shows the release that runs.

Running a newer installer over an installed copy (`PrepareToInstall` in the script) renames `librephotos` to
`librephotos-old` first, deleting an earlier `librephotos-old` that holds a release (`librephotos.exe` and
`build_info.json`), or moving one that holds anything else to `librephotos-old.superseded-<time>`, and then
copies the new release into an empty `librephotos`. It refuses while any `librephotos.exe` runs (WMI), unless
it is given `/SKIPRUNNINGCHECK`. The uninstaller deletes `librephotos` and every `librephotos-*` folder,
refuses while LibrePhotos runs, and only asks about the data folder (default **No**) when it is the default
`%LOCALAPPDATA%\LibrePhotos` and the uninstall is not silent.

`/DATADIR=` and `/PHOTOS=` put `--data-dir` and `--photos` into the shortcuts and the `Run` value and are
remembered for later installs (`Inno Setup CodeFile: DataDir` in the uninstall entry).

## Moving an unzipped copy to the installed version

A running 1.6.0 or 1.5.x only knows the zip swap, and its update to 1.7.0 arrives that way. From 1.7.0 on, a
portable copy offers **Move to the installed version** (Admin area card, tray item,
`POST /api/updates/move/`):

1. `api/updates/setup_file.py` downloads `LibrePhotos-Setup-<running release>.exe` of the release it runs
   into `<data folder>\updates`, from the same fixed GitHub URLs as an update, and checks its SHA-256
   against the release's `SHA256SUMS` (and the minisign signature once #2317 adds a key).
2. **Restart to finish moving** (`POST /api/updates/restart/`, the same as for an update) starts
   `librephotos.exe finish-move` from the running program folder, outside the instance's job object
   (`CREATE_BREAKAWAY_FROM_JOB`, or kill-on-close lifted at exit), and quits.
3. `librephotos/move_to_installed.py` waits for the old instance and its processes to end, runs the
   installer with `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /SKIPRUNNINGCHECK /LOG=<logs>\setup.log`
   and the instance's `/DATADIR` and `/PHOTOS`, starts the installed `librephotos.exe` with the old
   instance's arguments, environment and working folder, and waits for `/api/healthz/ready`.
4. Only then does it write `program-moved.json` into the data folder (old and new program folder) and
   delete the downloaded installer. The old folder is kept as the way back.
5. On any failure (the installer's exit code, no program folder registered, not ready within 30 minutes,
   anything unexpected) it stops what it started, starts the old copy again and says why in a message box;
   `update.log` has the steps.

Afterwards a `run` of the old copy (an old shortcut, the Startup folder, Task Scheduler) finds
`program-moved.json` naming its own folder, and hands the start over to the installed `librephotos.exe` with
the same arguments (`forward_to_installed`). Once the installed copy is uninstalled, the old copy runs
itself again. The installed copy shows one tray notification with the old folder's path.

The move needs a release (no `dev` build) and refuses, like an update, a data folder or a photo folder inside
the program folder; it does not need to write next to the program folder, so a copy unzipped into
`C:\Program Files` can move too.

`finish-update`'s arguments are a contract between two releases. `finish-move` runs the release's own binary,
but its arguments are pinned the same way (`api/tests/infra/test_move_to_installed.py`), and so are the
installer switches the app passes (`api/tests/infra/test_installation.py` reads the `.iss` file).

## CI

`.github/workflows/standalone-windows.yml` builds the installer right after the zip
(`scripts/build_installer.py --checksums`, LZMA2 max) with the runner's Inno Setup, pinned in
`INNO_SETUP_VERSION`, and attaches both names to a release. `scripts/smoke_installer.py` then runs on the same
build, on the runner (never on a developer's PC: it installs into the user profile):

1. publishes the build twice under test versions (98.0.0, and 98.0.1 as a zip only) into a local release
   feed served over HTTP on 127.0.0.1, with `SHA256SUMS`; `UPDATE_RELEASE_SOURCE` points the updater at it
   (plain HTTP only to this machine, `api.updates.download.release_source`);
2. **fresh install**: silent install, the files, the uninstall entry (`DisplayVersion`, `Publisher`,
   `DisplayIcon`, `InstallLocation`, nothing in `HKLM`), the Start menu shortcut, no autostart and no desktop
   shortcut by default, `asInvoker` in the installer's manifest; then the installed copy starts, an admin is
   created, three sample photos are scanned and listed;
3. **update in place**: the update check is told 98.0.1 is out (`UPDATE_CHECK_RESULT`), `install` and
   `restart` run through the API, and 98.0.1 must run from the same folder with `DisplayVersion` 98.0.1, the
   shortcut unchanged and 98.0.0 in `librephotos-old`;
4. **uninstall**: silent, the program folder, shortcuts, `Run` value and uninstall entry are gone, the data
   folder is not;
5. **migration**: the latest published release's zip (downloaded from GitHub Releases) runs from an unzipped
   folder, gets an admin and the photos, updates itself to 98.0.0 with its own Restart to update, then moves
   through the API; the same users and photos, a database backup, 98.0.0 running from the installed folder
   with the same `--data-dir`, both old folders kept with nothing running from them, the move record
   written, the installer deleted; a start of the old copy hands over; the final uninstall keeps the data.

It is a gate for pull requests and `continue-on-error` on releases until it has a record of passing runs, as
the Update smoke test was.

## Signing and the Microsoft Store

The Store's [MSI/EXE requirements](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msi/app-package-requirements)
and [Store Policies](https://learn.microsoft.com/windows/apps/publish/store-policies) 7.20 (September 2026),
10.2.9, and where LibrePhotos stands:

| Requirement | Status |
|---|---|
| `.exe` or `.msi`, standalone, no downloads while installing | Done: everything is in the one `.exe` |
| Silent install; a UAC prompt is allowed but not needed | Done: `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-` (the Partner Center field "installer parameters"), per-user, no UAC |
| A versioned HTTPS URL whose file never changes | Done: `https://github.com/LibrePhotos/librephotos/releases/download/<version>/LibrePhotos-Setup-<version>.exe`; release assets are only replaced with `replace_asset` |
| Clean uninstall (10.2.7), shown in **Installed apps** | Done |
| Installer and **every PE file** signed with a certificate from the Microsoft Trusted Root Program | Waits on #2317: the hook is in place, no certificate yet |
| Self-updating | Allowed: 10.2.5 (install and update only through the Store) covers games and Xbox products, and says it does not apply to 10.2.9 products. 10.2.2 (no code that changes the described functionality) is met by updating only to LibrePhotos' own releases, checked against `SHA256SUMS`. The Store does not update an EXE app; the next version is a new versioned URL in Partner Center |
| Reasonable download time and install success rate (10.4.4) | About 450 MB |

The signing hook: with the repository secrets `WINDOWS_SIGNING_CERTIFICATE` (a base64 PFX) and
`WINDOWS_SIGNING_PASSWORD`, the workflow sets `WINDOWS_SIGN_ARGS` (the `signtool` arguments; `WINDOWS_SIGNTOOL`
names another `signtool.exe`). `scripts/build_standalone.py` then signs every `.exe`, `.dll` and `.pyd` of the
build before it is zipped (`scripts/windows_signing.py`), and `scripts/build_installer.py` passes the same
command to Inno Setup's `SignTool`, which signs the installer and its uninstaller. Without the secrets
nothing is signed and the build says so. A cloud signing service (#2317) needs a different `signtool`
command line, not a different place.
