---
title: "The Mac app"
description: "How LibrePhotos Server.app is built, signed and proven on GitHub's macOS runners, how the built-in updater swaps an app bundle, what the menu bar needs from the main thread, and why the server is not in the Mac App Store."
sidebar_position: 9
---

<Since version="1.7.0" /> The same Nuitka build as the [Windows app](windows-installer.md), packed as
`LibrePhotos Server.app` for Apple silicon ([Mac app](../../../installation/macos.md) has the user's side).
`.github/workflows/standalone-macos.yml` builds it, proves it on a `macos-15` runner and, for a release,
attaches the Mac assets. It never marks a release Latest; `standalone-windows.yml` does that.

## Building it

```bash
cd apps/backend
python3.14 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt -r requirements.standalone.txt ffmpeg_bin-*-macosx_14_0_arm64.whl
pip install --no-deps -r requirements.nodeps.txt
python scripts/build_standalone.py --zip
```

Xcode's command line tools provide `clang`, `codesign`, `hdiutil`, `iconutil` and `sips`. There is no
published macOS wheel of ffmpeg yet: `scripts/ffmpeg/build.sh macos-arm64` builds it with the same sources
and switches as the Linux and Windows wheels ([The ffmpeg build](ffmpeg-build.md)), with
`--install-name-dir=@rpath` and `@loader_path` run paths so the libraries load from the app, and
`scripts/build_ffmpeg_wheel.py ... macos-arm64` packs it. The workflow's `ffmpeg` job does that once and
caches the wheel by the hash of the build scripts. `ffmpeg-wheel.yml` does not build the Mac wheel yet;
once it does and the release has it, `requirements.txt` can name it with a `sys_platform == "darwin"`
marker like the other platforms.

On macOS, `build_standalone.py` hands the Nuitka folder to `scripts/macos_bundle.py`, which writes into
`build/standalone/`:

| File | What |
| --- | --- |
| `LibrePhotos Server.app` | the app |
| `librephotos-<version>-macos-arm64.zip`, `librephotos-macos-arm64.zip` | the app zipped, what the updater downloads |
| `LibrePhotos-Server-<version>-macos-arm64.dmg`, `LibrePhotos-Server-macos-arm64.dmg` | the disk image with an Applications shortcut |
| `SHA256SUMS-macos-arm64` | the checksums of all four |

The Mac checksums have their own file so the two workflows never upload the same release asset; the
updater reads the file named in its release layout (`librephotos/release_layout.py`).

## The bundle

```text
LibrePhotos Server.app/Contents/
  Info.plist                 com.librephotos.server, LSUIElement, LSMinimumSystemVersion 14.0
  MacOS/LibrePhotos Server   apps/backend/macos/launcher.c, compiled at build time
  Resources/LibrePhotos.icns
  Resources/uninstall.sh     apps/backend/macos/uninstall.sh
  Resources/librephotos/     the Nuitka folder: librephotos, its libraries, frontend_build, static, ...
```

Nuitka builds with `--mode=app` on macOS (PyObjC, which the menu bar needs, refuses to compile otherwise),
and its app bundle puts every file into `Contents/MacOS`. `codesign` treats everything there as code and
signs data files through extended attributes, which a zip loses, so `build_standalone.py` takes Nuitka's
`Contents/MacOS` as the Nuitka folder and `macos_bundle.py` puts it into `Contents/Resources` instead, as
Electron apps do with their native modules. The bundle executable is a
40-line C program that `execv`s `Resources/librephotos/librephotos` with its own arguments: a symbolic link
or a script cannot be a bundle's main executable for notarization. The process keeps its process ID, so
Launch Services, the menu bar and the privacy prompts see the app. `LSUIElement` keeps it out of the Dock.

The data folder is `~/Library/Application Support/LibrePhotos` (`default_data_dir()`), never inside the
bundle. Nothing at run time writes into the bundle either: no process-name hard links as on Windows
(`named_executable`), no `.pyc` files (`sys.dont_write_bytecode`), and the prepared-update marker lives
next to the prepared app. The smoke test checks `codesign --verify --deep --strict` after running.

The build fails when the Nuitka folder contains symbolic links, since the updater refuses links in a zip.

## Signing and notarization

`macos_bundle.sign_app` signs every Mach-O file in the bundle inside out (deepest first), each with the
hardened runtime, executables with `ENTITLEMENTS`, then the bundle itself, and verifies it:

| Entitlement | Why |
| --- | --- |
| `com.apple.security.cs.disable-library-validation` | the wheels' libraries (numpy, onnxruntime, pyvips, opencv) are re-signed by us, and an ad hoc signature has no team ID to match |
| `com.apple.security.cs.allow-unsigned-executable-memory` | libffi closures (ctypes, cffi, PyObjC) |
| `com.apple.security.cs.allow-jit` | the same, on the newer allocation path |

None of these is a sandbox entitlement, and the app needs no `com.apple.security.network.server`: only a
sandboxed app needs it to listen.

The server and the [desktop app's macOS builds](../../desktop-macos.md#signing-and-publishing) share one
Apple account and one set of repository settings; that page has the account steps (**What the maintainer
sets up once**) and what each setting holds (**Repository settings**). The server needs only the Developer
ID Application certificate in the `.p12` and uses these settings:

| Name | Kind | Used for |
| --- | --- | --- |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | secrets | the `.p12` with the Developer ID Application certificate and its password |
| `APPLE_TEAM_ID` | variable | checked against the identity |
| `APPLE_SIGNING_IDENTITY` | variable | `Developer ID Application: <name> (<team>)`, what `codesign` signs with |
| `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_API_PRIVATE_KEY` | secrets | the App Store Connect API key `notarytool` notarizes with |

Without the first four the workflow signs ad hoc (`codesign --sign -`) and says in a notice which are
missing: that is enough to run on the runner, and Gatekeeper blocks a downloaded copy. With them but without
the API key it signs with the Developer ID and does not notarize. Pull requests never get these secrets and always sign ad hoc, so a dependency update or a branch cannot sign with the maintainer's certificate; pushes to `dev`, manual runs and releases sign and notarize. The certificate goes into a temporary keychain. The app is zipped with `ditto`, submitted with
`xcrun notarytool submit --wait` and stapled; then the disk image is made from the stapled app, signed,
submitted and stapled too. Only the maintainer can create the Developer ID (an Apple Developer Program
membership), the certificate and the API key.

## The menu bar

The tray is `pystray` on both systems; on macOS its backend is AppKit through PyObjC, which must run on the
main thread. `standalone.main()` therefore runs the server in a thread (`run_with_menu_bar`) and gives the
main thread to `macos_app.MainThread`: it runs queued work until the icon starts, then AppKit's run loop,
and every later change to the icon goes there with `AppHelper.callAfter`. uvicorn skips its signal handlers
off the main thread, and Python runs a signal handler only once the main thread runs Python again, which
it does not while AppKit's run loop waits. `macos_app.quit_on_signal` therefore lets the C-level handler
write SIGTERM and SIGINT to a wakeup pipe (`signal.set_wakeup_fd`) that a thread reads.
`macos_app.install_quit_handlers` answers the quit Apple Event (`applicationShouldTerminate:` answers
`NSTerminateLater` and replies once the server stopped). Both work like **Quit LibrePhotos**. Dialogs and
notifications are `osascript`, started without waiting so a failure never stops the server.

Windows ends the children with a job object. macOS has none, so the root exports `LIBREPHOTOS_ROOT_PID`
and every child (services, workers, start-up commands) watches it (`librephotos/root_watch.py`, started
by `bootstrap_process` and by the services' `serve_forever`). When the root is gone, also after
`kill -9`, a child ends its own children first (ExifTool's Perl) and then itself.

## Updating an app bundle

The updater (`api/updates`, `librephotos/updater.py`) works on the app as its program folder:
`ReleaseLayout.program_folder` goes up from `Resources/librephotos` to `LibrePhotos Server.app`.
`LibrePhotos Server.app-<version>` and `LibrePhotos Server.app-old` sit next to it; without the `.app`
suffix Launch Services never registers them. The extractor restores the executable bits from the zip, the
check wants both the launcher and the binary, and `finish-update` runs from the prepared app's binary. An
app that Launch Services started (it sets `__CFBundleIdentifier`) is started again with `open -n -a`, so it
is again the app macOS knows, with its privacy permissions; a start from Terminal is repeated as it was.
The update check offers a Mac only releases that have `librephotos-macos-arm64.zip`.

The move to an installed version is a Windows matter (`Moves` stays off on macOS).

## Open at Login

`librephotos/login_item.py` writes `~/Library/LaunchAgents/com.librephotos.server.plist`, which runs
`open -g -a <app> --args run --no-browser` at login and names the bundle in `AssociatedBundleIdentifiers`
so System Settings shows the app. A launch agent rather than `SMAppService`: it needs no extra PyObjC
framework, works with an ad hoc signature, and `launchctl` can prove it in CI.

## The proof

`scripts/smoke_macos.py` runs on the runner, scripted and asserting, in this order:

- **fresh**: mounts the build's disk image and checks its Applications shortcut and the app's signature,
  makes releases 98.0.0 (a disk image) and 98.0.1 (zip and checksums in a local feed served on
  `127.0.0.1`), copies 98.0.0 from its disk image to `/Applications`, opens it with `open` like Finder,
  checks the root was started by launchd, the data folder is `~/Library/Application Support/LibrePhotos`,
  every migration ran, creates the admin, checks every always-on service through the API and on its port,
  computes a perceptual hash, scans the three sample photos in `deploy/e2e/photos`, waits for their
  thumbnails, lists them through the API, and verifies the signature again after running;
- **update**: offers 98.0.1 with `UPDATE_RELEASE_SOURCE`, downloads it through `POST /api/updates/install/`,
  checks the prepared app's signature, restarts through `POST /api/updates/restart/`, and checks 98.0.1
  runs from the same path, `LibrePhotos Server.app-old` holds 98.0.0, both pass `codesign --verify --deep
  --strict`, the photos are unchanged and `update.log` ends with "the update is done";
- **autostart**: off by default, `start-at-login on` writes the launch agent, `launchctl bootstrap` loads it
  without a second instance, `off` removes it;
- **quit**: SIGTERM ends every process and uvicorn shuts down cleanly; the quit Apple Event (where the
  runner lets `osascript` send it); `kill -9` of the root ends its children;
- **uninstall**: `uninstall.sh` quits the app and removes it, its rollback and the login item, and keeps the
  library;
- **cask**: installs and uninstalls `deploy/homebrew/librephotos-server.rb` from a local tap, then
  `uninstall.sh --delete-data` deletes the library.

It takes screenshots with `screencapture` (the desktop with the menu bar icon, and the web UI in
Chromium). The `from-source` job runs `smoke_standalone.py --from-source` on macOS as a quick check of the
same code without the two-hour build. `REUSE_BUILD_FROM_RUN` at the top of the workflow, set to a run ID,
skips the build and tests that run's app, to iterate on packaging and the smoke test; it must stay empty
on `dev` (`api/tests/infra/test_macos_app.py` checks).

## What is not done

- **Intel**: onnxruntime 1.31, rawpy 0.28 and cryptography 50 have no `macosx_x86_64` wheels for Python
  3.14, so there is no `macos-x64` build.
- **Mac App Store**: not a fit. App Review Guideline 2.4.5 requires the sandbox (file access only to
  folders picked in a native panel, kept as security-scoped bookmarks; the web UI's folder picker cannot
  grant that), updates through the App Store only (the built-in updater would go), no downloading of
  code or resources that add features (the models), helpers signed to inherit the sandbox (every service,
  ExifTool's Perl, ffmpeg), and the GPL ffmpeg build cannot be distributed there. A sandboxed server is
  possible in principle (`com.apple.security.network.server`), but it would be a different product. The
  Viewer is the app that fits the store.
- **Homebrew**: the cask is in the repository; publishing it needs a tap (or homebrew/cask, which wants
  notarized apps) once the releases are notarized.
- **Docker data**: no importer; see [Coming from Docker](../../../installation/macos.md#coming-from-docker).
