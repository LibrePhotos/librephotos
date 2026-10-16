---
title: "⬆️ Upgrading"
description: "How LibrePhotos upgrades its database, the automatic SQLite backups and how to restore one, going back to an older release, and the two-step upgrade for installs older than 2026w10."
sidebar_position: 6
---

# Upgrading LibrePhotos

Every LibrePhotos release brings its own database migrations. The backend applies them by itself each time it starts, so upgrading is normally just pulling the new images and starting them again. The exact commands depend on how you installed LibrePhotos:

- [Standard Docker setup](standard-install.md#updating)
- [Single container deployment](unified-deployment.md): pull `reallibrephotos/librephotos-unified` again and recreate the container.
- [unRAID](unraid.md)
- [Windows standalone](windows-standalone.md#updating): quit LibrePhotos from the tray, rename the old program folder, unzip the new release next to it and start it.
- [Kubernetes](https://github.com/LibrePhotos/librephotos/tree/dev/deploy/k8s#upgrading): the image tags in `kustomization.yaml` are pinned, so check out the new release's tag, whose manifests name its images. Since 1.3.0 the manifests run PostgreSQL 16 instead of 13, so an older install moves its database with a dump and restore first.

Back up your database before any upgrade. It is the only way back if a migration fails halfway, and it is cheap:

```sh
# Standard Docker setup, from the folder with your docker-compose.yml and .env
docker compose exec -T db pg_dump -U docker librephotos > librephotos-backup.sql
```

Replace `docker` and `librephotos` with the `dbUser` and `dbName` from your `.env` if you changed them.

The [Windows standalone](windows-standalone.md) build and the [single container deployment](unified-deployment.md) with SQLite make this backup themselves, see below. On Windows, also keep your own copy of the `db` folder and of `protected_media\secret.key` on another drive, as [Backing up and restoring](windows-standalone.md#backing-up) shows step by step.

## "LibrePhotos is updating" {#updating-screen}

_Not released yet._ Up to 1.3.0, the web app showed empty pages or the login toast "No connection to backend server, try again in a few minutes." while the backend was not answering.

While the backend updates the database or starts up, the web app shows a page that says so instead of the login or your photos. It checks every 5 seconds and goes back to where you were by itself when LibrePhotos answers again; **Check now** asks at once.

- **LibrePhotos is updating**: the database update is running. A few minutes is normal; a large library can take longer. Do not stop the containers or quit the Windows app in the meantime. After 15 minutes the page adds a hint; if nothing changes for an hour, look at `command_migrate.log` in the logs folder.
- **LibrePhotos is starting**: the update is done and the backend is starting its services.
- **LibrePhotos is not answering**: the browser gets no answer from the backend at all, for example while its container restarts. If this lasts, check that the backend container (`docker compose ps`) or the Windows app is running.
- **The update could not finish**: the database update stopped with an error, and LibrePhotos did not start. Your photos are unchanged. The reason is in the logs folder, in `command_migrate.log` (Docker) or `console.log` (Windows app).
- **This LibrePhotos is too old to update in one step** (reason code E001): see [Upgrading from a release older than 2026w10](#old-releases).
- **This database belongs to a newer LibrePhotos** (reason code E002): see [Going back to an older release](#downgrade).

On a failure page, **For the person who runs this server** shows the reason code, and **Copy details** (on HTTPS and `localhost`) copies the state, reason code, version and time for a support question.

### Where the page comes from {#startup-page}

From the moment the backend container or the Windows app starts until LibrePhotos serves, a small start-up page answers on the backend's port and says what is going on. With the [standard Docker setup](standard-install.md) the web app shows it as described above. The [single container](unified-deployment.md) and the [Windows app](windows-standalone.md) also show it as a plain page of its own, so opening LibrePhotos during an update shows **LibrePhotos is updating** instead of "connection refused". The Windows app opens your browser on it right away.

After a failed update the backend no longer exits and restarts in a loop. It stays up and keeps showing the failure page:

- **Too old** (E001) or **newer database** (E002): nothing is tried again, because the fix needs you (see the linked sections). Restart the container, or start the Windows app again, after you fixed it.
- **Any other reason**: Docker tries the backup and the update again after 30 seconds, 1, 2 and 5 minutes, then every 5 minutes, so a database that came up late still gets there by itself. The Windows app shows the failure page until you close its message box.

The page never shows error messages or file paths, only the reason code; the details are in the logs folder: `command_migrate.log`, or `command_backup_database.log` when the backup before the update failed (Docker), and `console.log` on Windows.

With Docker Compose, the backend's healthcheck asks `/api/healthz/ready`, so `docker compose ps` shows the backend as `starting` while it updates, `healthy` once it serves, and `unhealthy` after a failed update (the healthcheck gives an update 15 minutes before it counts). `/api/healthz` answers from the first seconds on, so scripts that wait for LibrePhotos to serve should ask `/api/healthz/ready` instead.

## The Finish the upgrade card {#finish-the-upgrade}

<Since version="1.4.0" /> Up to 1.3.0, the work an update left was only described in the release notes, and some of it needed a terminal.

Some updates leave work to do once: data an older release stored needs reading again or cleaning up. LibrePhotos checks after each start what this server still needs, and shows it to admins on a **Finish the upgrade** card at the top of **Account menu > Admin Area**. While anything is left, the avatar in the top right corner has an orange dot and the **Admin Area** item in its menu shows how many tasks are left. Nothing is shown to other users, and nothing blocks the app meanwhile.

Each task has one row: what it does, why, and what happens to your photos (they are never changed). A running task shows how far it got and links to its job, which also shows in **Worker Logs** and on the avatar's progress ring.

- **Automatic** tasks start by themselves after the update. If one fails, its row says why and offers **Retry**; it is not started again by itself.
- **Optional** tasks wait for you: **Start** runs it, **Not now** hides it for good. While another job runs, **Start** waits and says so.

When a task is done, its row says so for a day, then goes; the card goes with its last task. A new install never shows the card: the tasks are about data an older release left behind.

| Task | Kind | When it shows |
| --- | --- | --- |
| Update search for the new search model | Automatic | Photos still have search data from an earlier search model. Search results may be incomplete until it finishes. |
| Remove photo details from old thumbnails | Automatic | After updating a server that already had photos: thumbnails from 1.2.1 or older carry the photo's location ([details](#strip-thumbnail-metadata)). |
| Read shutter speeds again | Automatic | After updating from 1.3.0 or older with shutter speeds stored wrongly ([details](#refresh-exposure-time)). |
| Read colour information of older videos | Optional | Videos added before LibrePhotos checked their colours when scanning, while ffprobe is available ([Probe Videos](../user-guide/job-system.md#probe-videos)). |

## Automatic backups with SQLite and on Windows {#sqlite-backups}

Not released yet: up to 1.3.0, nothing was backed up automatically.

When a start brings database migrations, the [Windows standalone](windows-standalone.md) build and the [single container deployment](unified-deployment.md) with its internal SQLite database copy the database first, before anything else opens it. Nothing is migrated without that copy. A start without migrations writes nothing.

The copies go into a `backups` folder next to the database:

| Install | Backups folder |
| --- | --- |
| Windows standalone | `%LOCALAPPDATA%\LibrePhotos\db\backups` (or `db\backups` in your `--data-dir`) |
| Single container with SQLite | `backups` in the folder you mount at `/db` |

Each backup is named after the release that made it, which is the release you updated to, and the time in UTC, for example `librephotos-<release>-20261013T083000Z.sqlite3`. It holds the database as the release you ran before left it, so it is what you need to go back to that release. A `.json` file with the same name says which migrations were about to run. The newest three are kept; set `DB_BACKUP_KEEP` to keep more or fewer (see [Environment variables](environment-variables.md#single-container-image)). Each one is about as large as the database.

A backup needs twice the size of the database in free disk space. If there is less, LibrePhotos does not start and says how much space to free (on Windows in a message box, in Docker in `command_backup_database.log` in the logs folder).

Only the database is copied. Thumbnails, converted videos and the machine learning models can all be made again, and a migration never changes your photos.

PostgreSQL databases are not backed up automatically: use `pg_dump` as shown above.

### Restoring a backup {#restore}

1. Quit LibrePhotos (on Windows: **Quit LibrePhotos** in the tray menu; in Docker: `docker stop librephotos`).
2. In the `db` folder, rename `librephotos.sqlite3` (for example to `librephotos.sqlite3.broken`). If `librephotos.sqlite3-wal` and `librephotos.sqlite3-shm` are there, rename them the same way.
3. Copy the backup from `db/backups` into the `db` folder and name it `librephotos.sqlite3`.
4. Start the release you ran before the update. On Windows, put its program folder back ([Going back to the previous release](windows-standalone.md#going-back)) or unzip its `librephotos-windows-x64.zip` from the [releases page](https://github.com/LibrePhotos/librephotos/releases); for Docker, use that release's image tag.

Starting the release named in the backup's file name, or any newer one, on the restored database runs the update again, after making a new backup.

## Going back to an older release {#downgrade}

Not released yet: up to 1.3.0, an older release started on a newer database without a word and failed later, when it saved a change.

A release cannot run on a database that a newer release has migrated: the newer release changed tables the older one does not know about. LibrePhotos refuses to start in that case and says so (in a message box on Windows, in `command_migrate.log` in the logs folder with Docker):

```text
?: (librephotos.E002) The database 'default' was last used by a newer LibrePhotos release (it has migration api.0170_..., which this release does not know). Running this older release on it could damage it.
	HINT: Start the newer release again, or restore the backup made before that upgrade ...
```

Nothing has been changed at that point. Either start the newer release again, or go back with the database as it was before the upgrade:

- SQLite (Windows standalone, single container with SQLite): [restore the automatic backup](#restore) made before the upgrade. Its file name names the release you upgraded to, and it holds the database as the release before left it.
- PostgreSQL: restore the `pg_dump` you made before upgrading into an empty database, then start the older release.

Changes made since the upgrade (faces named, albums edited, photos added) are not in the backup. The next scan finds photos that were added since.

Releases after 1.3.0 keep the secret key in `protected_media/secret.key` and move it there from the logs folder on their first start. 1.3.0 and older look for it in the logs folder (`logs\secret.key` on Windows, `/logs/secret.key` in Docker): when you go back to one of them, copy the key there first. Without it, that release makes a new key, everyone has to log in again, and the saved email server and Nextcloud passwords have to be entered again.

## After upgrading from 1.2.1 or older {#strip-thumbnail-metadata}

Thumbnails made by 1.2.1 and older still carry the photo's EXIF and XMP: its GPS position, camera serial number and keywords. A public link serves those thumbnails, so anyone holding one can read the location, even with location sharing off. Since 1.3.0, new thumbnails are written without it, but the ones already on disk keep it until you run the cleanup once.

<Since version="1.4.0" /> It runs by itself after the update, and the [Finish the upgrade card](#finish-the-upgrade) shows its progress. Up to 1.3.0, it had to be started by hand.

An admin can also start it in the web app: **Account menu > Admin Area > Admin Tools > Remove photo details from old thumbnails**, then **Start**. It runs as a job over the thumbnails of every user. The row shows how far it got and links to the job; its progress also shows in **Worker Logs** and on the avatar's progress ring. The job ends as failed, with the count and the thumbnails it could not clean, if any thumbnail still carries metadata afterwards.

Not released yet: up to 1.3.0, the cleanup is only available as the command below.

To run it from a script, or without the web app, use the management command:

```sh
# Standard Docker setup, from the folder with your docker-compose.yml and .env
docker compose exec backend python manage.py strip_thumbnail_metadata

# Single container deployment
docker exec librephotos python manage.py strip_thumbnail_metadata
```

On the [Windows standalone](windows-standalone.md) build, open `cmd`, go to the program folder and run the command with `start /wait`, as [Running a command](windows-standalone.md#running-a-command) shows step by step:

```bat
cd /d "C:\Users\<you>\LibrePhotos-app\librephotos"
start /wait librephotos.exe manage strip_thumbnail_metadata

rem With another data folder, --data-dir comes before manage:
start /wait librephotos.exe --data-dir D:\LibrePhotos manage strip_thumbnail_metadata
```

Both only rewrite thumbnails that still carry metadata, and keep their pixels and colour profile, so running them again is safe. Add `--dry-run` to the command to only count them. See [Management Commands](../user-guide/library.md#management-commands).

## After upgrading from 1.3.0 or older {#refresh-exposure-time}

_Not released yet._ Up to 1.3.0, the shutter speed shown in Info was stored wrongly for fast and long exposures: anything faster than about 1/2000 s as `0`, 1/1250 to 1/2000 s as `1/1000`, and 2.5 s as `5/2`. The old value cannot be repaired from the database, so the exposure time of those photos is read again, once.

<Since version="1.4.0" /> This runs by itself after the update, as the **Read Shutter Speeds Again** job, and the [Finish the upgrade card](#finish-the-upgrade) shows its progress. Only that one value is read from each photo and only the shutter speed is stored; your files are not changed.

To run it again from a script, use the management command:

```sh
# Standard Docker setup, from the folder with your docker-compose.yml and .env
docker compose exec backend python manage.py refresh_exposure_time

# Single container deployment
docker exec librephotos python manage.py refresh_exposure_time
```

On the [Windows standalone](windows-standalone.md) build, run `start /wait librephotos.exe manage refresh_exposure_time` in `cmd`, from the program folder (see [Running a command](windows-standalone.md#running-a-command); with another data folder, `--data-dir` comes before `manage`).

It reads only the exposure time and writes only the shutter speed, so running it again is safe. Add `--dry-run` to only count the photos. A Rescan from the Library page fixes them too.

### The log file is now `librephotos.log` {#log-file-renamed}

_Not released yet._ Up to 1.3.0, the backend log in the logs folder (`BASE_LOGS`, `/logs` in the container) is called `ownphotos.log`. Newer releases call it `librephotos.log`. The first start of a newer release renames `ownphotos.log` and its older parts (`ownphotos.log.1`, `ownphotos.log.2`, ...) to the new name, so the history is kept, and logs a warning saying so. The lines in it look the same as before.

Anything that reads the file by name has to be pointed at the new one: Promtail, Fluent Bit or Vector configs, fail2ban filters (`logpath`), `tail -f` aliases and scripts. The **Server Logs** download in the Admin Area follows by itself.

If the old file cannot be renamed (on Windows, another program such as an editor or a log viewer has it open), it is left as it is, the backend logs a warning and writes to a new `librephotos.log`. The same happens to an old file found next to an existing `librephotos.log`: it is left alone, and the log says so once. Delete `ownphotos.log` once you no longer need it. The `.__ownphotos.lock` file next to it is no longer used either and can be deleted.

## Upgrading from a release older than 2026w10 {#old-releases}

Releases after 1.1.0 combine the first 100 database migrations into a single one. That keeps new installs and the test suite fast, but it means these releases can no longer bring a database from an older release up to date on their own.

| Your current release | What to do |
| --- | --- |
| 2026w10, 2026w14, 2026w25, 1.0.0 to 1.0.3, 1.1.0, or anything newer | Upgrade directly, as usual. |
| 2025w44 or older | Upgrade in two steps, as described below. |

Installs on 2026w10 or later can upgrade directly. Older installs must first upgrade to any release from 2026w10 up to 1.1.0 (1.1.0 is the last release with the individual migrations), start it once so its migrations run, and then upgrade to the latest release.

If you skip the intermediate step, nothing is changed: the backend stops before migrating and its log (`command_migrate.log` in your logs folder) says which release to go through first:

```text
?: (librephotos.E001) The database 'default' was created by a LibrePhotos release older than 2026w10: ...
	HINT: Upgrade in two steps. First run any release from 2026w10 up to 1.1.0 ...
```

### Two-step upgrade with Docker Compose

1. Back up the database as shown above.
2. In your `.env`, pin the intermediate release by setting `tag=1.1.0`. Then pull and start it:

   ```sh
   docker compose pull
   docker compose up -d
   docker compose logs -f backend
   ```

   Wait until the backend has finished migrating and LibrePhotos opens in your browser as usual. Migrating a large library can take a while; do not stop the containers in the meantime.
3. Set `tag` back to `latest` (or the release you want to run), then pull and start again:

   ```sh
   docker compose pull
   docker compose up -d
   ```

For the single container deployment the steps are the same: run `reallibrephotos/librephotos-unified:1.1.0` once with your existing data, wait for it to finish starting, then switch back to `reallibrephotos/librephotos-unified:latest`.

### Not sure which release you are on?

If you run 1.2.0 or newer, you can always upgrade directly. Otherwise, before upgrading, ask the backend you are running now:

```sh
docker compose exec backend python manage.py showmigrations api | grep -E '0100_|squashed_0100'
```

If this prints `[X]` (or `[-]`) in front of `0100_metadataedit_metadatafile_photometadata_stackreview_and_more` or of `0001_squashed_0100`, your database is recent enough to upgrade directly. Releases since 1.2.0 print the second one. If it prints `[ ]` in front of `0100_metadataedit_...`, or nothing at all, use the two-step upgrade.
