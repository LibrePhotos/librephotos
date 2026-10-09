---
title: "⬆️ Upgrading"
description: "How LibrePhotos upgrades its database, and the two-step upgrade for installs older than 2026w10."
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

## After upgrading from 1.2.1 or older {#strip-thumbnail-metadata}

Thumbnails made by 1.2.1 and older still carry the photo's EXIF and XMP: its GPS position, camera serial number and keywords. A public link serves those thumbnails, so anyone holding one can read the location, even with location sharing off. Since 1.3.0, new thumbnails are written without it, but the ones already on disk keep it until you run the cleanup once:

```sh
# Standard Docker setup, from the folder with your docker-compose.yml and .env
docker compose exec backend python manage.py strip_thumbnail_metadata

# Single container deployment
docker exec librephotos python manage.py strip_thumbnail_metadata
```

On the [Windows standalone](windows-standalone.md) build, run `start /wait librephotos.exe manage strip_thumbnail_metadata` in `cmd`.

The command only rewrites thumbnails that still carry metadata, and keeps their pixels and colour profile, so running it again is safe. Add `--dry-run` to only count them. See [Management Commands](../user-guide/library.md#management-commands).

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
