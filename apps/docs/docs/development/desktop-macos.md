---
title: "Desktop app: macOS builds"
description: "How the desktop app is built for macOS: one universal app bundled twice, as a Developer ID disk image for GitHub releases and as a sandboxed Mac App Store package, how files reach it through Apple Events, HEIC through ImageIO, where each build keeps its data, the CI proof on Apple Silicon and Intel runners, and the Apple account steps for signing, notarization and App Store Connect."
sidebar_position: 8
---

<Since version="1.7.0" />

:::note Signed ad hoc until a maintainer has an Apple Developer account
Both macOS builds are made and tested on every desktop CI run. Until the Apple certificates below are set up they are signed ad hoc: the disk image on a release opens only after the user allows it in System Settings, and nothing is uploaded to App Store Connect.
:::

The [desktop app](./desktop.md) ships two ways on macOS, both from the same universal (`arm64` and `x86_64`) build:

| | Direct download | Mac App Store |
| --- | --- | --- |
| File | `librephotos-desktop-<version>-macos-universal.dmg`, attached to the GitHub release | `librephotos-desktop-<version>-macos-universal-appstore.pkg`, uploaded to App Store Connect |
| Signature | Developer ID Application, hardened runtime, notarized and stapled | Apple Distribution, installer signed with Mac Installer Distribution, provisioning profile embedded |
| Sandbox | no | App Sandbox |
| Entitlements | none | `src-tauri/macos/AppStore.entitlements`, plus the team's application identifier |
| Data | `~/Library/Application Support/com.librephotos.viewer` and the folders listed below | the same folders inside `~/Library/Containers/com.librephotos.viewer/Data` |
| Updates | download the newer disk image (or `brew upgrade`) | the App Store |

Both have the bundle identifier `com.librephotos.viewer`, the Photography category (`LSApplicationCategoryType`), `ITSAppUsesNonExemptEncryption` set to false (the app only uses HTTPS, which is exempt) and macOS 12 as the minimum (`bundle.macOS.minimumSystemVersion`; the UI needs a WebKit from Safari 16, which macOS 12 gets through updates).

## Tooling

Tauri 2 bundles both: `tauri bundle --bundles app,dmg` makes the `.app` and the disk image, and signs and notarizes when it finds an identity and App Store Connect API key in the environment ([Tauri: macOS code signing](https://v2.tauri.app/distribute/sign/macos/), [App Store](https://v2.tauri.app/distribute/app-store/)). What Tauri does not do is the App Store package, which is one `productbuild --component <app> /Applications` call (`scripts/macos/package-app-store.sh`).

`scripts/macos/config.mjs` writes the per-build Tauri config overlays that `--config` merges into `tauri.conf.json`:

- `developer-id`: the version, `CFBundleVersion` (the CI run number, which only grows, as App Store Connect wants), the signing identity (`-`, ad hoc, unless one is given) and the hardened runtime.
- `app-store`: the same plus the entitlements file it writes from `src-tauri/macos/AppStore.entitlements`, with `com.apple.application-identifier` (`<team>.com.librephotos.viewer`) and `com.apple.developer.team-identifier` added when a team ID is given, and the provisioning profile copied to `Contents/embedded.provisionprofile`. Those two entitlements are restricted: an app that claims them without a matching profile is killed at launch, so the ad hoc build leaves them out.
- `check` holds `bundle.fileAssociations[].contentTypes` to the extensions (every extension's UTI is claimed, nothing else is); `cask` writes the Homebrew cask.

Its tests run with `node --test "apps/desktop/scripts/macos/*.test.mjs"`.

The app is compiled once (`tauri build --target universal-apple-darwin --no-bundle`), then bundled per build without recompiling (`tauri bundle`).

## File types and opening files

`tauri.conf.json`'s `fileAssociations` become `CFBundleDocumentTypes`: role Viewer, rank `Alternate`, so the app is offered under **Open With** for every type but never becomes the default by installing it. Each group lists its UTIs in `contentTypes` (`LSItemContentTypes`): `public.jpeg`, `public.png`, `com.compuserve.gif`, `org.webmproject.webp`, `com.microsoft.bmp`, `public.tiff`, `public.heic`, `public.heif`, `public.avif`, `public.jpeg-xl`, and for RAW only `public.camera-raw-image`, which every camera's RAW type, DNG's `com.adobe.raw-image` included, conforms to. Claiming `com.adobe.raw-image` itself made the app the default for DNG on install, because LaunchServices prefers a claim of the exact type over Preview's claim of the parent; the smoke test catches that kind of change. With `LSItemContentTypes` present LaunchServices ignores the extension list, which stays for Windows.

macOS has no **Set as default photo viewer** link to open: the user picks the app in Finder's **Get Info** > **Open with** > **Change All**. The hint that offers it is shown on Windows only, and `open_default_apps_settings` rejects elsewhere.

A file opened from Finder, **Open With** or `open -a` does not come on the command line: LaunchServices starts the app (or finds it running) and sends an Apple Event, which Tauri reports as `RunEvent::Opened` with `file://` URLs. `opened.rs` holds the state between the two moments that matter:

- Before the UI asked for its first picture (`initial_path`), an opened file is held and its folder listed right away, as for a command-line file; the last one wins.
- After that, it is delivered to the window as `viewer://open`, which also brings the window to the front.

The UI subscribes to `viewer://open` before it calls `initial_path`, so a file that arrives between the two is not lost. LaunchServices already keeps one instance per app and sends a running app the event instead of starting another, so the single-instance plugin is not used on macOS (its `/tmp` socket is also outside the sandbox).

## HEIC, HEIF and AVIF

On macOS `decode/imageio.rs` decodes through ImageIO, the system's image codecs, before the pure-Rust decoders, as WIC does on Windows: `CGImageSourceCreateThumbnailAtIndex` at the size the box needs (orientation applied, so it never decodes larger than shown for a `screen` or `thumb`), drawn into an sRGB bitmap context (which also converts Display P3 and other profiles). It reads HEIC and HEIF (macOS 10.13 and later), AVIF (macOS 13), JPEG XL (macOS 14), WebP, TIFF and camera RAW, and is the fallback after a failed RAW develop. Picture sizes for `image_info` and tiles come from its properties. The other platforms still refuse HEIC, HEIF and AVIF. Video frames are not decoded on macOS yet (they would need AVFoundation); videos play, but have no thumbnail.

## Where each build keeps its data

`appdirs.rs` puts the library (`local.db`), `settings.json` and `folder-access.json` in `~/Library/Application Support/com.librephotos.viewer`, thumbnails in `~/Library/Caches/com.librephotos.viewer/thumbs` and zoom tiles in `~/Library/Caches/com.librephotos.viewer/tiles`. WebKit keeps the web view's data in `~/Library/WebKit/com.librephotos.viewer`, `~/Library/HTTPStorages/com.librephotos.viewer` and its own cache folders under `~/Library/Caches/com.librephotos.viewer`, and macOS adds `~/Library/Preferences/com.librephotos.viewer.plist` and `~/Library/Saved Application State/com.librephotos.viewer.savedState`. The sign-in token is in the login Keychain (service `LibrePhotos Viewer`). Edits go into XMP sidecars next to the pictures.

In the sandbox `HOME` is the container, `~/Library/Containers/com.librephotos.viewer/Data`, so the App Store build keeps all of the same folders inside it without any code of its own, and it can not write anywhere else. Deleting an app from `/Applications` leaves its data on macOS; the user guide lists what to remove.

### No import between the two builds

The Microsoft Store build imports the installer build's library once ([Desktop app: Microsoft Store package](./desktop-store.md#importing-the-installer-builds-library)); the Mac App Store build does not, for three reasons:

1. The sandbox cannot read the direct download's folder. The only ways in are Apple's container migration (`container-migration.plist`), which moves the files instead of copying them, so trying the App Store build once would empty the direct download's library, and a `temporary-exception` entitlement, which App Review asks to justify and usually refuses.
2. The library would not work if it were copied: its folders were added without a security-scoped bookmark, so the sandboxed app could not read them, and the user has to pick each folder again anyway.
3. Nothing has shipped for macOS yet, so there is no library to carry over.

So the two builds have separate libraries, and the user guide says so. The direct download reads the container only if a user points it there; it never looks on its own.

### Folder access in the sandbox

The sandbox lets the app read what the user opened or picked (`com.apple.security.files.user-selected.read-write`) and `~/Pictures` (`com.apple.security.assets.pictures.read-write`), nothing else:

- **A picture opened from Finder** comes with access to that file only. When listing its folder fails with a permission error, `list_folder` returns just that file with `limited: true`, and the viewer shows **Show the whole folder**, which opens the folder dialog at that folder. Picking it grants the folder.
- **Folders picked in the dialog** (library folders and **Show the whole folder**) are kept as security-scoped bookmarks (`com.apple.security.files.bookmarks.app-scope`) in `folder-access.json` by `folder_access.rs`, through `remember_folder`. At start-up, before the window loads, each bookmark is resolved and `startAccessingSecurityScopedResource` called, so the library's folders and their watchers keep working after a restart; a stale bookmark is renewed, one that no longer resolves is dropped. Outside the sandbox (`APP_SANDBOX_CONTAINER_ID` unset) nothing is stored.
- Moving a picture to the Trash uses `NSFileManager.trashItemAtURL` (trash's `NsFileManager` method) in both builds, instead of asking Finder over Apple Events, which the sandbox forbids and which would make the direct download ask for Automation permission.
- Links (`open_external`) and **Show in Finder** (`reveal_in_folder`) run `/usr/bin/open`, which works from the sandbox.
- Network: `com.apple.security.network.client`, for the server and the map tiles. The app opens no listening socket.

The direct download asks for nothing up front; macOS asks once for the Desktop, Documents, Downloads and removable or network volumes, with the reasons in `src-tauri/Info.plist`.

### Windows features on macOS

| Windows | macOS |
| --- | --- |
| WIC decoding, Explorer's thumbnail cache | ImageIO; no system thumbnail cache |
| Registry file associations, **Set as default photo viewer** | `CFBundleDocumentTypes`; the hint is hidden, the user uses **Get Info** > **Open with** |
| Single-instance mutex and second-launch arguments | LaunchServices and Apple Events |
| Credential Manager | Keychain (keyring's `apple-native`) |
| Recycle Bin, Explorer, `Ctrl` | Trash, Finder, `⌘` in the UI's labels (`src/platform.ts`) |

## CI

`.github/workflows/desktop.yml` adds three jobs:

1. **`macos`** (`macos-15`, Apple Silicon): tests the packaging script, runs clippy and the Rust tests on macOS (including ImageIO decoding a PNG and a HEIC that `sips` writes), builds the universal app, bundles the ad hoc disk image and App Store app, packages the App Store app with `productbuild` and checks the product archive (`pkgutil --check-signature`, the Distribution's identifier, a universal app, the component's `/Applications` install location, a signed app in the payload), and uploads both (artifact `librephotos-desktop-macos-universal-adhoc`). When the signing settings below are complete it signs again with the real identities, notarizes and staples the disk image, signs the package, validates it with `altool` and, for a release, uploads it to App Store Connect (artifact `librephotos-desktop-macos-universal-signed`). Otherwise the job summary lists what is missing.
2. **`macos-smoke`**, for each of `macos-15` and `macos-15-intel` and each build, runs `scripts/macos/smoke.sh` on the ad hoc artifact, which fails on the first step that does not hold:
   - installs as a user would: the disk image is mounted (its `Applications` link checked) and the app copied to `/Applications`; the package goes through `sudo installer -target /`, which must put the app into `/Applications` and leave a receipt;
   - checks the signature (`codesign --verify --strict`, hardened runtime), both architectures (`lipo`), the Info.plist (identifier, category, export compliance, minimum macOS, the claimed UTIs), the entitlements (`codesign -d --entitlements`: the App Store build has exactly the sandbox ones and no `get-task-allow`, the direct download none) and prints Gatekeeper's verdict (`spctl`, which rejects an ad hoc signature);
   - asks LaunchServices (`NSWorkspace.urlsForApplications`, via `scripts/macos/probe.swift`) whether it offers the app for a JPEG, a HEIC, PNG, TIFF, HEIF, AVIF, WebP, DNG, CR3 and ARW, and that every one of those types that had a default app before the install still opens with it;
   - cold start: `open -a <app> e2e_01.jpg`, waits for the window title `e2e_01.jpg - LibrePhotos Viewer` (from the window list, `CGWindowListCopyWindowInfo`), checks the process is (App Store) or is not (direct download) sandboxed (`sandbox_check`), saves a screenshot;
   - running instance: `open -a` with `e2e_02.jpg` and `open -b com.librephotos.viewer` with `e2e_03.jpg` must change the title of the same process, with no second one;
   - HEIC: a HEIC made with `sips` from `e2e_04.jpg`, opened the same way, must show and get a thumbnail in the disk cache;
   - data: `local.db` and the WebKit folder in the build's folders; for the App Store build, the container is a real sandbox container and nothing named after the app appeared anywhere else in `~/Library`, the home folders or `/tmp` (only the empty `~/Library/Application Scripts/com.librephotos.viewer` that macOS makes for every sandboxed app); for the direct download, no container, and everything it wrote is in the folders the cask's `zap` lists; the picture folders are unchanged;
   - stops the app, removes it (and the receipt), and lists the data macOS leaves behind.

   For the disk image, `scripts/macos/cask-smoke.sh` then installs it with Homebrew from a local tap (`brew install --cask`, with a `file://` URL), and `brew uninstall --zap --cask` must remove the app and every folder the smoke test left behind. Screenshots are uploaded as `macos-smoke-<build>-<runner>`.
3. **`macos-release`**, for a release or a dispatch with `tag`: attaches `librephotos-desktop-<version>-macos-universal.dmg`, `librephotos-desktop-macos-universal.dmg` (a stable name for a `latest/download` link) and `SHA256SUMS-desktop-macos`, the notarized ones when Developer ID signing is configured and the ad hoc ones (with a warning) until then, and uploads the cask for that version (artifact `librephotos-viewer-cask`). The App Store package is never attached.

Never run `smoke.sh` on your own Mac: it installs into `/Applications` with `sudo` and deletes the app's data.

### What CI cannot prove without an Apple account

- Notarization and stapling, Gatekeeper accepting the disk image, and how the notarized app behaves on a fresh Mac.
- App Store Connect accepting the package (`altool --validate-app`), App Review, and the App Store build signed with Apple Distribution: such a build only runs once Apple has re-signed it for distribution, so CI tests the same app signed ad hoc, which the sandbox enforces just the same.
- Security-scoped bookmarks surviving a restart need a person to pick a folder in the dialog, which a runner cannot do; the store and its renewal logic are unit-tested with a fake.

## Signing and publishing

### What the maintainer sets up once

1. **Apple Developer Program** membership for the LibrePhotos organisation (needs a D-U-N-S number) or a person, and its **Team ID** (Membership details).
2. **Certificates** (Certificates, Identifiers & Profiles > Certificates): **Developer ID Application** (direct download), **Apple Distribution** (or the older **Mac App Distribution**) and **Mac Installer Distribution** (App Store package). Export all three with their private keys into one `.p12` from Keychain Access.
3. **App ID** `com.librephotos.viewer` (Identifiers, explicit, platform macOS), no extra capabilities.
4. **Provisioning profile**: **Mac App Store Connect** distribution profile for that App ID and the distribution certificate.
5. **App Store Connect API key** (Users and Access > Integrations > App Store Connect API, role Developer or App Manager): its Key ID, the Issuer ID and the downloaded `AuthKey_<id>.p8`. One key serves notarization and uploads.
6. **App Store Connect record**: Apps > New App, platform macOS, bundle ID `com.librephotos.viewer`, SKU `librephotos-viewer`, category Photography, price free; the privacy policy URL `https://docs.librephotos.com/docs/user-guide/desktop/privacy` ([the page](../user-guide/desktop/privacy.md) covers the Mac builds too) and the App Privacy answers (Data Not Collected: the app sends pictures only to the user's own server); the App Review notes from the [Microsoft Store page](./desktop-store.md#submitting-to-the-store) apply here too (works without a server, no test account needed).

### Repository settings

| Name | Kind | What |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | secret | the `.p12` with all three certificates, base64 (`base64 -i certificates.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | secret | its export password |
| `APPLE_PROVISIONING_PROFILE` | secret | the Mac App Store Connect profile, base64 |
| `APPLE_API_KEY_ID` | secret | the API key's Key ID |
| `APPLE_API_ISSUER` | secret | the Issuer ID |
| `APPLE_API_PRIVATE_KEY` | secret | the contents of `AuthKey_<id>.p8` |
| `APPLE_TEAM_ID` | variable | the 10-character Team ID |
| `APPLE_SIGNING_IDENTITY` | variable | `Developer ID Application: <name> (<team>)` |
| `APPLE_APP_STORE_IDENTITY` | variable | `Apple Distribution: <name> (<team>)` |
| `APPLE_INSTALLER_IDENTITY` | variable | `3rd Party Mac Developer Installer: <name> (<team>)` (how Mac Installer Distribution certificates are named) |

The `macos` job signs, notarizes and staples the disk image when the certificate, password, team, API key and `APPLE_SIGNING_IDENTITY` are set, and signs, validates and (for a release) uploads the App Store package when the certificate, password, team, API key, profile and both App Store identities are set. Each half says in the job summary what it is missing. The certificates go into a temporary keychain that the job deletes at the end. Uploaded builds appear in App Store Connect under TestFlight; a maintainer adds them to a version and submits it for review there.

### Homebrew

The cask for each release is the `librephotos-viewer-cask` artifact of the `macos-release` job: it installs `LibrePhotos Viewer.app` from the release's disk image, checks the SHA-256, follows new GitHub releases (`livecheck`) and zaps the app's folders. Homebrew's main tap only takes apps that pass Gatekeeper, so submit it to [homebrew/homebrew-cask](https://github.com/Homebrew/homebrew-cask) (`brew bump-cask-pr` after the first) only once the disk image is notarized. A tap of our own (`LibrePhotos/homebrew-tap`) could carry it earlier, but its users would still get the Gatekeeper prompt.
