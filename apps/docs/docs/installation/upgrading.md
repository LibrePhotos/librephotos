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

Back up your database before any upgrade. It is the only way back if a migration fails halfway, and it is cheap:

```sh
# Standard Docker setup, from the folder with your docker-compose.yml and .env
docker compose exec -T db pg_dump -U docker librephotos > librephotos-backup.sql
```

Replace `docker` and `librephotos` with the `dbUser` and `dbName` from your `.env` if you changed them.

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

Before upgrading, ask the backend you are running now:

```sh
docker compose exec backend python manage.py showmigrations api | grep 0100_
```

If this prints `[X] 0100_metadataedit_metadatafile_photometadata_stackreview_and_more`, your database is recent enough to upgrade directly. If it prints `[ ]` in front of that line, or nothing at all, use the two-step upgrade.
