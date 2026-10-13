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
- [Kubernetes](https://github.com/LibrePhotos/librephotos/tree/dev/deploy/k8s#upgrading): the image tags in `kustomization.yaml` are pinned, so check out the new release's tag, whose manifests name its images. Since 1.3.0 the manifests run PostgreSQL 16 instead of 13, so an older install moves its database with a dump and restore first.

Back up your database before any upgrade. It is the only way back if a migration fails halfway, and it is cheap:

```sh
# Standard Docker setup, from the folder with your docker-compose.yml and .env
docker compose exec -T db pg_dump -U docker librephotos > librephotos-backup.sql
```

Replace `docker` and `librephotos` with the `dbUser` and `dbName` from your `.env` if you changed them.

The [Windows standalone](windows-standalone.md) build and the [single container deployment](unified-deployment.md) with SQLite make this backup themselves, see below.

## Automatic backups with SQLite and on Windows {#sqlite-backups}

Not released yet: up to 1.3.0, nothing was backed up automatically.

When a start brings database migrations, the [Windows standalone](windows-standalone.md) build and the [single container deployment](unified-deployment.md) with its internal SQLite database copy the database first, before anything else opens it. Nothing is migrated without that copy. A start without migrations writes nothing.

The copies go into a `backups` folder next to the database:

| Install | Backups folder |
| --- | --- |
| Windows standalone | `%LOCALAPPDATA%\LibrePhotos\db\backups` (or `db\backups` in your `--data-dir`) |
| Single container with SQLite | `backups` in the folder you mount at `/db` |

Each backup is named after the release that made it and the time in UTC, for example `librephotos-1.3.0-20261013T083000Z.sqlite3`: that is the release to go back to with it. A `.json` file with the same name says which migrations were about to run. The newest three are kept; set `DB_BACKUP_KEEP` to keep more or fewer (see [Environment variables](environment-variables.md#single-container-image)). Each one is about as large as the database.

A backup needs twice the size of the database in free disk space. If there is less, LibrePhotos does not start and says how much space to free (on Windows in a message box, in Docker in `command_backup_database.log` in the logs folder).

Only the database is copied. Thumbnails, converted videos and the machine learning models can all be made again, and a migration never changes your photos.

PostgreSQL databases are not backed up automatically: use `pg_dump` as shown above.

### Restoring a backup {#restore}

1. Quit LibrePhotos (on Windows: **Quit LibrePhotos** in the tray menu; in Docker: `docker stop librephotos`).
2. In the `db` folder, rename `librephotos.sqlite3` (for example to `librephotos.sqlite3.broken`). If `librephotos.sqlite3-wal` and `librephotos.sqlite3-shm` are there, rename them the same way.
3. Copy the backup from `db/backups` into the `db` folder and name it `librephotos.sqlite3`.
4. Start the release named in the backup's file name. For Windows, unzip that release's `librephotos-windows-x64.zip` from the [releases page](https://github.com/LibrePhotos/librephotos/releases); for Docker, use that release's image tag.

Starting a newer release on the restored database migrates it again, after making a new backup.

## Going back to an older release {#downgrade}

Not released yet: up to 1.3.0, an older release started on a newer database without a word and failed later, when it saved a change.

A release cannot run on a database that a newer release has migrated: the newer release changed tables the older one does not know about. LibrePhotos refuses to start in that case and says so (in a message box on Windows, in `command_migrate.log` in the logs folder with Docker):

```text
?: (librephotos.E002) The database 'default' was last used by a newer LibrePhotos release (it has migration api.0170_..., which this release does not know). Running this older release on it could damage it.
	HINT: Start the newer release again, or restore the backup made before that upgrade ...
```

Nothing has been changed at that point. Either start the newer release again, or go back with the database as it was before the upgrade:

- SQLite (Windows standalone, single container with SQLite): [restore the automatic backup](#restore) made before the upgrade. Its file name names the release it belongs to.
- PostgreSQL: restore the `pg_dump` you made before upgrading into an empty database, then start the older release.

Changes made since the upgrade (faces named, albums edited, photos added) are not in the backup. The next scan finds photos that were added since.

## After upgrading from 1.2.1 or older {#strip-thumbnail-metadata}

Thumbnails made by 1.2.1 and older still carry the photo's EXIF and XMP: its GPS position, camera serial number and keywords. A public link serves those thumbnails, so anyone holding one can read the location, even with location sharing off. Since 1.3.0, new thumbnails are written without it, but the ones already on disk keep it until you run the cleanup once.

An admin starts it in the web app: **Account menu > Admin Area > Admin Tools > Remove photo details from old thumbnails**, then **Start**. It runs as a job over the thumbnails of every user. The row shows how far it got and links to the job; its progress also shows in **Worker Logs** and on the avatar's progress ring. The job ends as failed, with the count and the thumbnails it could not clean, if any thumbnail still carries metadata afterwards.

Not released yet: up to 1.3.0, the cleanup is only available as the command below.

To run it from a script, or without the web app, use the management command:

```sh
# Standard Docker setup, from the folder with your docker-compose.yml and .env
docker compose exec backend python manage.py strip_thumbnail_metadata

# Single container deployment
docker exec librephotos python manage.py strip_thumbnail_metadata
```

On the [Windows standalone](windows-standalone.md) build, run `start /wait librephotos.exe manage strip_thumbnail_metadata` in `cmd`.

Both only rewrite thumbnails that still carry metadata, and keep their pixels and colour profile, so running them again is safe. Add `--dry-run` to the command to only count them. See [Management Commands](../user-guide/library.md#management-commands).

## After upgrading from 1.3.0 or older {#refresh-exposure-time}

_Not released yet._ Up to 1.3.0, the shutter speed shown in Info was stored wrongly for fast and long exposures: anything faster than about 1/2000 s as `0`, 1/1250 to 1/2000 s as `1/1000`, and 2.5 s as `5/2`. The old value cannot be repaired from the database, so read the exposure time of those photos again, once:

```sh
# Standard Docker setup, from the folder with your docker-compose.yml and .env
docker compose exec backend python manage.py refresh_exposure_time

# Single container deployment
docker exec librephotos python manage.py refresh_exposure_time
```

On the [Windows standalone](windows-standalone.md) build, run `start /wait librephotos.exe manage refresh_exposure_time` in `cmd`.

It reads only the exposure time and writes only the shutter speed, so running it again is safe. Add `--dry-run` to only count the photos. A Rescan from the Library page fixes them too.

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
