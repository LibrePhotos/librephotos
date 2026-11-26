---
title: "Desktop app"
description: "The LibrePhotos desktop app (preview): a fast picture viewer for Windows, a library of your own folders, local search, and backup to your LibrePhotos server."
sidebar_position: 26
---

:::note Preview
<Since version="1.7.0" /> The desktop app is a preview: what it does and how it looks can still change. Its Windows installer comes with every LibrePhotos release from 1.7.0 on.
:::

The **LibrePhotos desktop app** (its window is called *LibrePhotos Viewer*) is two things in one:

- a **picture viewer** that opens JPEG, HEIC, AVIF, JPEG XL, PNG, WebP, TIFF and camera RAW files at once when you double-click them in Explorer, and lets you rate, caption and tag them, and
- a **library** of the folders you choose, with search, that can back them up to your LibrePhotos server.

It works without a server. Everything you do to your own pictures stays on your computer and in the pictures' own files, so other photo apps (and the LibrePhotos server, if it scans the same folders) see it too. When you connect a server, the app also shows what the server knows about a picture, such as the people in it and its albums.

| Page | What it covers |
| --- | --- |
| [Viewing pictures](./viewer.md) | Opening pictures, moving through a folder, zoom, rotate, delete, slideshow, the info panel, keyboard shortcuts |
| [Editing a picture's details](./editing.md) | Favourites, star ratings, captions, keywords and the date taken, and where those changes are saved |
| [Library and search](./library.md) | Adding folders, the timeline, searching your pictures |
| [Connecting a server and backup](./server.md) | Signing in, backing up folders, uploading one picture, what the server adds to the viewer |
| [Settings](./settings.md) | Where edits are saved, maps, changes waiting for the server |
| [Privacy policy](./privacy.md) | What the app stores, what it sends and to whom |

## Installing it

<Since version="1.7.0" />

1. Download [**librephotos-desktop-windows-x64-setup.exe**](https://github.com/LibrePhotos/librephotos/releases/latest/download/librephotos-desktop-windows-x64-setup.exe) from the latest release (64-bit Windows 10 or 11). The same file is there as `librephotos-desktop-<version>-windows-x64-setup.exe`, next to `SHA256SUMS-desktop` to check the download: in PowerShell, `Get-FileHash .\librephotos-desktop-windows-x64-setup.exe` must print the SHA-256 listed for it.
2. Run it. Windows may show **Windows protected your PC**, because the installer is not signed yet: click **More info**, then **Run anyway**.
3. Choose who the app is for. **Install just for me** needs no administrator rights and installs into `%LOCALAPPDATA%\Programs\LibrePhotos Viewer`. **Install for anyone using this computer** asks an administrator and installs into `C:\Program Files\LibrePhotos Viewer`. Either way **LibrePhotos Viewer** is added to the Start menu.

Started without a picture, the app opens the library. Started with a file (or with a picture double-clicked once the app is your default viewer), it opens that picture.

The installer never changes which app opens your pictures; you choose. To make LibrePhotos Viewer the viewer Windows opens pictures with:

- **Installed for anyone using this computer:** click **Choose LibrePhotos Viewer as your photo viewer** on the installer's last page, or later choose **Set as default photo viewer** in the **⋮** menu of the viewer. Both open Windows' **Default apps** settings at the app's page, which lists every picture and RAW format it reads with the app that opens it now. Click a format and pick **LibrePhotos Viewer**; Windows asks once per format.
- **Installed just for you:** Windows may not show the app's page in **Default apps** until you sign out and back in. Until then, right-click a picture, choose **Open with** → **Choose another app** → **Choose an app on your PC**, select `%LOCALAPPDATA%\Programs\LibrePhotos Viewer\librephotos-viewer.exe` and click **Always**, once per format.

To update, run the installer of the newer release; your library, settings and edits stay. To remove the app, use **Settings** → **Apps** → **Installed apps** → **LibrePhotos Viewer** → **Uninstall**; tick **Delete the application data** to remove the library, caches and settings too (see below). Your pictures and their sidecars are never removed.

macOS and Linux builds don't exist yet. To build the app yourself, see [Development: Desktop app](../../development/desktop.md).

### The Microsoft Store build

<Since version="1.7.0" /> The app is being prepared for the Microsoft Store and is not listed there yet. The Store build is the same app; Windows installs, updates and removes it, and it needs no administrator rights.

- **Making it your photo viewer:** the Store build never changes which app opens your pictures either. Choose **Set as default photo viewer** in the **⋮** menu of the viewer, or go to **Settings** → **Apps** → **Default apps** → **LibrePhotos Viewer**, and pick it for the formats you want. It is also listed under **Open with**.
- **Switching from the installer:** keep the installer build installed until you have started the Store build once. On its first start the Store build copies your library, search index and settings from the installer build (once; caches are rebuilt), and you stay signed in to your server. Then uninstall the installer build. Leave **Delete the application data** unticked to keep its copy of the library, or tick it to remove that copy. From then on the two copies are separate.
- **Both installed:** this works, but **Open with** lists LibrePhotos Viewer twice and only one of them runs at a time: a picture you open with the other one shows up in the one already running.
- **Removing it** from **Settings** → **Apps** → **Installed apps** deletes the Store build's library, caches and settings with it. Your pictures and their sidecars stay.

## Where the app keeps its data

| What | Where |
| --- | --- |
| The library, search index and settings | `%LOCALAPPDATA%\com.librephotos.viewer\local.db`; for the [Microsoft Store build](#the-microsoft-store-build) `%LOCALAPPDATA%\Packages\<LibrePhotos Viewer's package>\LocalCache\Local\com.librephotos.viewer\local.db` |
| Thumbnails and zoom tiles | `%LOCALAPPDATA%\com.librephotos.viewer\cache` and `tiles` |
| Your server sign-in | the server address and user in `settings.json` next to the database; the sign-in token in the Windows Credential Manager |
| Ratings, captions, keywords and dates you edit | next to each picture in an XMP sidecar by default, see [Where edits are saved](./editing.md#where-edits-are-saved) |

On macOS the folder is `~/Library/Application Support/com.librephotos.viewer`, on Linux `$XDG_DATA_HOME/com.librephotos.viewer`. Deleting the folder resets the app; your pictures and their sidecars are not in it. The program itself lives in a separate folder (`%LOCALAPPDATA%\Programs\LibrePhotos Viewer` when installed just for you, `C:\Program Files\LibrePhotos Viewer` when installed for everyone), so an update or an uninstall never touches the data unless you ask for it.
