---
title: "🪟 Windows standalone (no Docker)"
description: "One folder with librephotos.exe: the server, the frontend and the machine learning models, without Docker or Python."
sidebar_position: 5
---

:::info Unreleased
The standalone build is on the `dev` branch and not part of a release yet. It is produced by the
`standalone-windows` GitHub Actions workflow; download the `librephotos-windows-x64` artifact from a
workflow run, or the zip attached to the release the run was pointed at.
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

1. Unzip `librephotos-windows-x64.zip` anywhere, for example `C:\Program Files\LibrePhotos` or a
   folder in your home directory.
2. Double-click `librephotos.exe`. A console window opens and shows the log; after the first
   migrations your browser opens `http://localhost:8000/`.
3. Create the admin account on the first-time setup screen, then set the scan directory of your user
   (Admin area → Users) to the folder with your photos and start a scan.

The models for face recognition, tagging, captions and semantic search are downloaded on the first
scan, into the data directory below; that needs an internet connection once.

Closing the console window stops LibrePhotos: the workers and the sidecars are child processes of it
and go down with it.

### Where things go

| What | Where |
|---|---|
| Database, thumbnails, models, logs | `%LOCALAPPDATA%\LibrePhotos` (`--data-dir` to move it) |
| Photos | Stay where they are; scan directories may be anywhere under your home directory (`--photos` to allow another top directory, e.g. `--photos D:\`) |

### Options

```
librephotos.exe --help
librephotos.exe run --port 8080 --no-browser
librephotos.exe --data-dir D:\LibrePhotos --photos D:\Pictures
librephotos.exe manage createadmin -u admin admin@example.com
librephotos.exe manage <any manage.py command>
```

The [environment variables](environment-variables.md) of the Docker images work too, set in the
console before starting `librephotos.exe`; the data directory options above only fill in `BASE_DATA`,
`BASE_LOGS` and `PHOTOS` when they are not set. A default `SECRET_KEY` is generated and kept in the
logs directory.

## Building it yourself

```powershell
cd apps\backend
py -3.11 -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt -r requirements.standalone.txt
.\.venv\Scripts\python scripts\build_standalone.py --zip
```

This builds the frontend (Node 22 and Yarn on PATH; `--skip-frontend` reuses `apps/frontend/dist`),
collects the static files and compiles the backend; Nuitka needs Visual Studio's C++ build tools and
downloads the rest itself. Expect the first build to take well over an hour, later ones are much
faster thanks to Nuitka's cache. The result lands in `apps\backend\build\standalone\librephotos\`.
