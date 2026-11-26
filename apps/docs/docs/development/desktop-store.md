---
title: "Desktop app: Microsoft Store package"
description: "How the desktop app is packaged as an MSIX for the Microsoft Store: the manifest and its Partner Center identity, file types, WebView2, where the packaged app keeps its data and how it imports the installer build's library, the CI proof, and the Store submission steps."
sidebar_position: 7
---

<Since version="1.7.0" />

:::note Not in the Store yet
The package is built and tested on every desktop CI run, but nothing is submitted until a maintainer reserves the name in Partner Center and fills in the identity below. Until then the Store package carries placeholder identity values and only the [installer](../user-guide/desktop/index.md#installing-it) is released.
:::

The [desktop app](./desktop.md) ships two ways on Windows: the NSIS installer attached to every GitHub release, and an MSIX package for the Microsoft Store. Both contain the same `librephotos-viewer.exe`; the Store package only adds a manifest, its logos and a resource index around it.

## Tooling

Tauri 2 cannot build MSIX itself ([tauri-apps/tauri#4818](https://github.com/tauri-apps/tauri/issues/4818)). `apps/desktop/scripts/msix/pack.mjs` builds the package with the Windows SDK's own `makepri.exe` and `makeappx.exe`, which every GitHub Windows runner has. The alternatives were weighed and left out:

| Option | Why not |
| --- | --- |
| Microsoft's `winapp` CLI ([guide for Tauri](https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli/guides/tauri)) | Pre-1.0 (0.8), its manifest comes from an interactive `winapp init` and it downloads its own SDK build tools; underneath it runs the same `makepri`/`makeappx`/`signtool`. |
| [`tauri-windows-bundle`](https://github.com/Choochmeque/tauri-windows-bundle) | A young community project (one maintainer, a few dozen stars) with its own manifest template and a native helper binary; little gained over a script for one architecture. |

The script owns the whole manifest, so what Partner Center certifies is in this repository, and it needs nothing outside the SDK. Its unit tests (`node --test "apps/desktop/scripts/msix/*.test.mjs"`) hold the manifest to the installer: the same extensions as `bundle.fileAssociations` in `tauri.conf.json` and the NSIS hooks, only `runFullTrust`, every field filled.

Build it locally (Windows 10 SDK 10.0.19041 or newer; `WINDOWS_SDK_BIN` picks one):

```bash
node apps/desktop/scripts/msix/pack.mjs --exe apps/desktop/src-tauri/target/release/librephotos-viewer.exe --version 1.7.0 --out dist-msix
```

It writes `librephotos-desktop-<version>-windows-x64.msix` and `.msixupload` (a zip of the `.msix`, what Partner Center takes) plus `layout/`, the unpacked package. The package is unsigned: the Store signs what it publishes. Installing it on your own machine needs Developer Mode or a trusted test certificate; CI does that on a throwaway runner instead (see below).

## The manifest

`apps/desktop/src-tauri/windows/AppxManifest.xml` is the template; `pack.mjs` fills it in.

| Field | Value |
| --- | --- |
| `Identity Name`, `Publisher`, `PublisherDisplayName` | From the environment: `MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER`, `MSIX_PUBLISHER_DISPLAY_NAME` (in CI the repository variables of the same names). Unset, they are the placeholders `PLACEHOLDER.LibrePhotosViewer`, `CN=PLACEHOLDER-PartnerCenter-Publisher` and `PLACEHOLDER Partner Center publisher`, the build warns, and `--require-identity` (used for a Store submission) refuses to build. |
| `Version` | The release tag `X.Y.Z` as `X.Y.Z.0`. The Store reserves the fourth part, so it is always 0, and every submission needs a higher version than the last. Outside a release CI builds `0.0.0.0`. |
| `ProcessorArchitecture` | `x64`. An Arm64 package would need an `aarch64-pc-windows-msvc` build of the app and a Windows Arm runner to test it; not done yet. |
| `TargetDeviceFamily` | `Windows.Desktop`, from 10.0.17763 (Windows 10 1809), `MaxVersionTested` 10.0.26100, which also turns on the `registeredAUMID` link to the app's **Default apps** page. |
| Application | `EntryPoint="Windows.FullTrustApplication"`: a regular desktop app with package identity, file system and registry virtualisation, no app container. |
| Capabilities | `runFullTrust` only, a restricted capability that Partner Center asks to justify (text below). |
| Logos | Generated from `src-tauri/icons/icon.png` by `scripts/msix/assets.ps1` at build time: Store logo, 44, 71, 150 and 310 px squares and the 310 x 150 wide tile at scales 100 to 400, plus the taskbar and Start sizes (`targetsize-16` to `256`, plated and unplated), indexed into one `resources.pri`. |

File types are one `uap3:FileTypeAssociation` per group of `bundle.fileAssociations` (pictures and camera RAW, 27 extensions), with `Parameters="&quot;%1&quot;"` so a double-clicked file arrives as the first argument, as with the installer. A packaged app's file types never become the default on their own: Windows lists the app under **Open with** and on its page in **Settings** > **Apps** > **Default apps**, and the user picks, the same behaviour as the installer's hooks. **Set as default photo viewer** in the viewer opens `ms-settings:defaultapps?registeredAUMID=<package family name>!App` when the app runs packaged (`ops.rs`).

`unvirtualizedResources` is not used: the app does not need to write to the real AppData, and it would need another restricted capability.

## WebView2

The package cannot depend on the WebView2 Runtime: the Runtime is not a framework package, so there is no `PackageDependency` to declare. The package relies on the Evergreen Runtime that Windows 11 includes and Windows Update has installed on supported Windows 10 versions. No first-run check is added: when the Runtime is missing, Tauri's release build already shows an error with the download link before it would open a window (`tauri-runtime-wry`'s `create_webview`). The installer build keeps its NSIS bootstrapper.

## Where the packaged app keeps its data

A packaged desktop app writes new files under `%LOCALAPPDATA%` into `%LOCALAPPDATA%\Packages\<package family name>\LocalCache\Local\...` instead, and Windows deletes that folder when the app is removed. Files that already exist in the real folder are read, and changed, in place ([Microsoft: AppData operations](https://learn.microsoft.com/windows/msix/desktop/desktop-to-uwp-behind-the-scenes#appdata-operations-on-windows-10-version-1903-and-later)). For a SQLite database in WAL mode that is a trap: an existing `local.db` from the installer build would be changed in the real folder while its new `-wal` and `-shm` files land in the package folder, so two processes could see two different databases.

So the packaged app never goes through the virtualised path. `packaged::identity()` asks Windows for the app's AUMID (`GetCurrentApplicationUserModelId`); with one, `appdirs` puts everything (database, `settings.json`, caches, tiles) under `%LOCALAPPDATA%\Packages\<package family name>\LocalCache\Local\com.librephotos.viewer`, the same folder virtualisation would have used, and `lib.rs` points Tauri's directories there too (`app.appDirectoriesOverride`), which moves the WebView2 profile (`EBWebView`). `LPVIEW_DATA_DIR` still wins over all of it.

### Importing the installer build's library

On the first packaged start, if the package folder has no `local.db`, `settings.json` or import marker, and `%LOCALAPPDATA%\com.librephotos.viewer` (the installer build's folder) has `local.db` or `settings.json`, `packaged::import` copies them once:

1. `local.db` (with its `-wal`, if any) and `settings.json` are copied into `com.librephotos.viewer.importing` next to the package folder. A leftover from an earlier, interrupted import is deleted first.
2. The copied database must pass `PRAGMA quick_check`; it is checkpointed so it no longer needs a `-wal`.
3. `imported-from-installer-build.json` (where from, which files, and when as Unix milliseconds from the system clock, `std::time`) is written, then the files and the marker are moved into the package folder, the marker last.

Any failure deletes the staging folder and the app starts with an empty library; nothing is ever merged into a packaged library that already exists, and the installer build's folder is only read. Caches, tiles and the WebView2 profile are not copied: they are rebuilt (the only web storage the UI keeps is whether the default-viewer hint was dismissed). The import runs in Tauri's `setup`, after the single-instance check, so it never runs in a second instance or while another one has the library open; that is also why the local database and the server connection are opened there.

The sign-in token is in the Windows Credential Manager under the service `LibrePhotos Viewer`, which is not virtualised, so a signed-in user stays signed in. Edits live in XMP sidecars next to the pictures, outside both folders.

### The installer build and the Store build side by side

Both can be installed at once, and nothing stops a user from doing so. Then **Open with** lists LibrePhotos Viewer twice, and the two share the single-instance lock (`com.librephotos.viewer-sim`, a named mutex in the user's session, which a full-trust package does not isolate), so whichever runs first takes every file the other is asked to open. After the import their libraries are separate. The user guide therefore tells users to start the Store build once, then uninstall the installer build.

## CI

The `msix` job of `.github/workflows/desktop.yml` runs after the `installer` job, from the same `librephotos-viewer.exe` (artifact `librephotos-viewer-exe`, kept for a day):

1. runs the packaging script's tests and builds the package with the version the installer was stamped with;
2. `scripts/msix/smoke-msix.ps1` proves it on the runner (GitHub runners are throwaway, with administrator rights): signs a copy with a self-signed certificate whose subject is the manifest's `Publisher` and trusts it in `LocalMachine\TrustedPeople`, installs it with `Add-AppxPackage`, checks `Get-AppxPackage` and, for each of the 27 extensions, that the package registered the type (`AppModel\Repository\Packages\<full name>\App\Capabilities\FileAssociations`), that `OpenWithProgids` offers its ProgID and that the ProgID opens `<family name>!App`, and that `.jpg`'s default is unchanged. It starts the app through its AUMID with a picture (`IApplicationActivationManager::ActivateApplication`) and waits for the window title `<picture> - LibrePhotos Viewer`, saves a screenshot, opens a second picture through the package's `.jpg` ProgID (`ShellExecuteEx` with that class, what **Open with** does; `ActivateForFile` is only for UWP-style file activation and refuses a full-trust app) and checks that the running viewer shows it and no second process stays, checks that `local.db` and `EBWebView` are in the package's `LocalCache` and nothing appeared in `%LOCALAPPDATA%\com.librephotos.viewer`, then removes the package and checks that the package, its data, its install folder and its **Open with** entries are gone. Then the import: it runs the plain exe once to create the installer build's library, adds a marker row and a `settings.json`, installs again, opens a picture, and checks the marker file, the row and the settings in the package folder, that the installer build's folder did not change (every file's size and time), that the installer build started now hands its file to the running packaged viewer, that a second start does not import again, and that removing the package leaves the installer build's library;
3. runs the Windows App Certification Kit (`appcert.exe test -appxpackagepath`) on the test-signed package and writes its results to the job summary; a failing WACK test is a warning, not a failed job. The overall result is PASS. The one failure is the optional **Blocked executables** test, which flags any reference to process-launch APIs and shells (`CreateProcessW` and `cmd.exe` from Rust's `std::process` and WebView2, `ShellExecuteW` for opening links, Explorer and Settings); it matters only for Windows in S mode, like the S mode issue Tauri apps hit in [tauri-apps/tauri#14935](https://github.com/tauri-apps/tauri/issues/14935); as an optional test it does not change the overall PASS;
4. uploads the unsigned `.msix` and `.msixupload` (artifact `librephotos-desktop-windows-x64-msix`) and, always, the screenshots and the WACK report (`msix-smoke-report`).

The packages are not attached to GitHub releases: an unsigned MSIX cannot be installed by users.

The test certificate, the trust and the installs happen only on the runner. Never run `smoke-msix.ps1` on your own machine: it installs and removes the package, trusts a certificate machine-wide and deletes `%LOCALAPPDATA%\com.librephotos.viewer`.

## Submitting to the Store

The first submission is done by hand in [Partner Center](https://partner.microsoft.com/dashboard/apps-and-games/overview); later ones can come from CI.

1. **Reserve the name.** **Apps and games** > **New product** > **MSIX or PWA app**, name `LibrePhotos Viewer` (or what is free).
2. **Fill in the identity.** **Product management** > **Product identity** lists `Package/Identity/Name`, `Package/Identity/Publisher` and `Package/Properties/PublisherDisplayName`. Set them as repository variables (**Settings** > **Secrets and variables** > **Actions** > **Variables**) `MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER` and `MSIX_PUBLISHER_DISPLAY_NAME`, exactly as shown. Set `MSSTORE_PRODUCT_ID` to the Store ID (12 characters, `9N...`).
3. **Build a release package**: dispatch the desktop workflow from the release tag (`gh workflow run desktop.yml --ref <tag> -f tag=<tag>`) and download `librephotos-desktop-<tag>-windows-x64.msixupload` from the `librephotos-desktop-windows-x64-msix` artifact. Check that the job summary does not warn about placeholders.
4. **Create the submission**: upload the `.msixupload` under **Packages** (Windows 10/11 desktop), fill in **Properties** (category Photo & video, the privacy policy URL), **Age ratings** (the IARC questionnaire: no violence, no user-to-user communication, no purchases; the app shows the user's own pictures), **Store listings** (description, at least one screenshot at 1366 x 768 or larger, from the user guide) and **Pricing and availability** (free).
5. **Explain `runFullTrust`** in **Submission options** > **Restricted capabilities**:

   > LibrePhotos Viewer is a desktop photo viewer built with Tauri (Rust and WebView2). It needs runFullTrust to run as a regular Win32 desktop app: it opens pictures from any folder the user chooses or double-clicks, decodes them (including camera RAW files) with Windows Imaging Component and its own decoders, writes the user's ratings, captions and keywords into XMP sidecar files next to those pictures, watches the user's library folders for changes, moves deleted pictures to the Recycle Bin, and stores the sign-in token for the user's own LibrePhotos server in the Windows Credential Manager.

6. **Notes for certification**, so testers do not get stuck on the server part:

   > The app works without an account or a server: open any JPEG, PNG, HEIC or RAW picture with it (or start it and add a folder of pictures in the library). Connecting to a LibrePhotos server is optional; it is the user's own self-hosted server (https://docs.librephotos.com), so there is no test account to provide. The app has no in-app purchases and collects no telemetry.

7. **Privacy policy.** The Store requires one because the app can connect to a server and, if the user turns the map on, loads map tiles from OpenStreetMap. Enter `https://docs.librephotos.com/docs/user-guide/desktop/privacy` in **Properties**. The page is [user-guide/desktop/privacy.md](../user-guide/desktop/privacy.md): update it in the same PR as any change to what the app sends, such as a new online service, crash reporting or an update check.
8. **Submit.** Certification usually takes one to three business days.

### Store listing text

Paste these into **Store listings** > **English**. They lead with what the built-in Photos app lacks (camera RAW, no account, your own folders) and keep the server optional, so the app reads as complete on its own.

**Description**

> LibrePhotos Viewer opens your pictures the moment you double-click them: JPEG, PNG, WebP, TIFF, JPEG XL and camera RAW files from Canon, Nikon, Sony, Fujifilm, Olympus, Panasonic, Pentax and DNG with its own decoders, HEIC and AVIF through the Windows image extensions, plus MP4 and MOV videos.
>
> Rate, caption and tag pictures without changing them. Your edits go into XMP sidecar files next to each picture, which digiKam, darktable, Lightroom and LibrePhotos read too, so nothing is locked into this app.
>
> Add your folders to a library to browse them as a timeline and search them by file name, folder, date, camera, caption or keyword. The library follows your folders as you add, move and delete pictures.
>
> No account, no subscription, no ads, no telemetry. Your pictures stay where they are.
>
> Run your own LibrePhotos server? Sign in to back up your folders to it and see the people, albums and places it found. LibrePhotos is free, open-source software (MIT license).

**Product features** (one per line)

> Opens camera RAW and JPEG XL pictures with its own decoders, no extra codecs needed
> Opens HEIC and AVIF pictures through the Windows image extensions
> Rate, caption and tag pictures in XMP sidecars other photo apps read
> A library of your own folders with a timeline and search
> Zoom, rotate, slideshow and keyboard shortcuts for going through a folder fast
> Moves deleted pictures to the Recycle Bin
> No account, no subscription, no ads, no telemetry
> Optional backup to your own LibrePhotos server
> Free and open source

**Search terms**: `photo viewer`, `RAW viewer`, `HEIC viewer`, `image viewer`, `XMP`, `self-hosted`, `LibrePhotos`.

**Screenshots** (at least 1366 x 768, PNG): the shots in `apps/docs/static/img/shots/desktop/` are 1600 x 1025; convert them with `magick <name>.webp <name>.png`. Use the info panel shot first, then editing details. Add a shot of the library timeline once the user guide has one. They use the demo library, no personal pictures.

**Privacy policy URL**: `https://docs.librephotos.com/docs/user-guide/desktop/privacy`. **Website**: `https://docs.librephotos.com/docs/user-guide/desktop/`. **Support contact**: `https://github.com/LibrePhotos/librephotos/issues`.

### Later updates from CI

For a release (or a dispatch with `tag`) the `msix` job can submit the package itself. It only does so when all of these are set, and says in the job summary which are missing otherwise:

| Name | Kind | What |
| --- | --- | --- |
| `MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER`, `MSIX_PUBLISHER_DISPLAY_NAME` | variables | the product identity (step 2) |
| `MSSTORE_PRODUCT_ID` | variable | the Store ID |
| `MSSTORE_TENANT_ID`, `MSSTORE_CLIENT_ID`, `MSSTORE_CLIENT_SECRET` | secrets | a Microsoft Entra app: in Partner Center **Account settings** > **User management** > **Microsoft Entra applications**, add one with the **Manager** role (or create it in the Entra admin center and add it there), then create a client secret for it; the tenant ID is shown with it |
| `MSSTORE_SELLER_ID` | secret | **Account settings** > **Legal info** > **Developer** > Seller ID |

It then builds the package again with `--require-identity`, installs the [Microsoft Store Developer CLI](https://learn.microsoft.com/windows/apps/publish/msstore-dev-cli/overview) with [`microsoft/microsoft-store-apppublisher`](https://github.com/microsoft/microsoft-store-apppublisher) (the older `microsoft/store-submission` action is deprecated) and runs `msstore publish -i <msixupload> -id <product id> --noCommit`, which uploads the package into a draft submission based on the last published one. A maintainer reviews the draft in Partner Center and submits it; drop `--noCommit` once that is routine. A client secret expires (at most after two years): renew it in Entra and update `MSSTORE_CLIENT_SECRET`.
