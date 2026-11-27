---
title: "Running a public demo"
description: "Run LibrePhotos as a view-only demo with sample photos on a small server."
sidebar_position: 7
---

<Since version="1.7.0" />

A demo lets people look around LibrePhotos before they install it. It is the normal single-container image with a few environment variables: `DEMO_SITE=true` makes the whole server view-only, and the machine learning services and background workers stay off, so the container idles at a fraction of its usual memory. The library is prepared once, with machine learning on, and then served as it is.

## What visitors can and cannot do

Visitors sign in with one shared account. The login page shows its name and password and offers **Sign in to the demo**, so nobody has to type them.

They can browse everything the account has: the timeline, photos and videos, the info panel with similar photos, People, Places, Events, Things, albums, search and the map. The app shows a **Demo, view only** badge next to the account menu, and hides upload, **Select**, editing, sharing, rating and delete.

The server refuses every change with `403` and the error code `demo_site_read_only`: uploads, scans, edits, deletes, sharing, settings, user admin, password changes and job starts, for every account, admins included. Only signing in, refreshing a sign-in and signing out still work. A change the web app still offers somewhere is answered with a message saying the demo is view only.

## 1. Prepare the library

Use photos you may publish. Never use your own photos: everyone who opens the demo sees them, with their dates and places.

Run the image normally first, without `DEMO_SITE`, so the machine learning services find faces, things and places. A desktop does this in minutes; on a small Arm server the Things model's first start alone can take half an hour, so prepare on a faster machine if you can and copy the folders to the server afterwards.

```bash
docker run -d --name demo-prep \
  -v /srv/demo/photos:/data \
  -v /srv/demo/db:/db \
  -v /srv/demo/protected_media:/protected_media \
  -v /srv/demo/logs:/logs \
  -e SERVE_FRONTEND=true -e WEB_CONCURRENCY=1 \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='<a long random password>' -e ADMIN_EMAIL= \
  -e MAP_API_PROVIDER=exiftool \
  -p 127.0.0.1:3000:8001 \
  reallibrephotos/librephotos-unified:<tag>
```

Then create the demo account, point it at the photos and scan them:

```bash
docker exec -e DJANGO_SETTINGS_MODULE=librephotos.settings.production_noproxy demo-prep \
  python manage.py createuser demo demo@example.org --password demo1234
```

Sign in as the admin, open **Admin**, set the demo account's scan directory (`/data/demo` when the photos are in `/srv/demo/photos/demo`), then sign in as `demo` and run **Scan photos**. Wait until the jobs page shows every job finished, name the People, and stop the container: `docker rm -f demo-prep`. The volumes keep the database, thumbnails and face crops.

Make the demo account a normal user, not an admin: a demo admin could read the Admin pages.

## 2. Run the demo

Start the same image on the same volumes with demo mode on:

```bash
docker run -d --name demo --restart unless-stopped \
  --memory 1500m \
  -v /srv/demo/photos:/data:ro \
  -v /srv/demo/db:/db \
  -v /srv/demo/protected_media:/protected_media \
  -v /srv/demo/logs:/logs \
  -e SERVE_FRONTEND=true \
  -e DEMO_SITE=true -e DEMO_USERNAME=demo -e DEMO_PASSWORD=demo1234 \
  -e WEB_CONCURRENCY=2 \
  -e NUM_PROXIES=1 -e AUTH_THROTTLE_RATE=120/minute \
  -e UPDATE_CHECK=false \
  -p 3000:8001 \
  reallibrephotos/librephotos-unified:<tag>
```

| Variable | Why |
| --- | --- |
| `DEMO_SITE=true` | View-only, no background workers, and of the machine learning services only the small similar-photos index ([Demo mode](environment-variables.md#demo-mode)). |
| `DEMO_USERNAME`, `DEMO_PASSWORD` | The account the login page offers. Its password is public. |
| `DEMO_SERVICES` | Leave it unset: it defaults to `image_similarity`, without which every opened photo waits about a second for Similar photos. `image_similarity,tags` also brings back search by meaning, for about 1 GB more memory; the demo account then needs semantic search results turned on in its settings. |
| `WEB_CONCURRENCY=2` | One web server process per core. `1` saves about 170 MiB and answers fewer people at once (see below). |
| `NUM_PROXIES=1` | Behind a reverse proxy (Traefik, Caddy, nginx). Otherwise every visitor seems to come from the proxy's address and all of them share one sign-in budget ([Sign-in rate limits](environment-variables.md#sign-in-rate-limits)). Leave it at `0` when visitors reach the container directly. |
| `AUTH_THROTTLE_RATE=120/minute` | Visitors behind one address (a classroom, a conference) all sign in to the same account, and the default of 10 a minute would turn some of them away. |
| `UPDATE_CHECK=false` | Nobody installs updates on a demo through the app. |

The database stays SQLite: a demo only reads, and SQLite needs no second container.

## How much it needs

Measured on a Hetzner CAX11 (2 Arm cores, 4 GB) with 38 sample photos, `DEMO_SITE=true` and the settings above:

| | Idle | Under load |
| --- | --- | --- |
| Memory | about 330 MiB (160 MiB with `WEB_CONCURRENCY=1`) | at most 650 MiB |
| CPU | under 1 % | both cores busy from about 20 visitors at once |
| Disk | 690 MB: 80 MB of photos plus the database and thumbnails, and 600 MB of models from the preparation, which the demo does not use and you may delete | |

About 10 to 15 people clicking around at the same moment get 95 % of their answers within a second. The server then serves about 150 requests a second, roughly 25 new visitors a minute. More visitors at once wait longer but still get every answer (200 at once: 95 % within 15 s). The limit is the CPU, not memory or bandwidth (about 12 Mbit/s at full load); a cache in front of the web app's files (`/assets/`) or more cores raise it.

Each visitor in the load test signs in, scrolls the timeline (two screens of thumbnails), opens three photos, then People, Places and Events, with a few seconds between steps, as a person does. How it was measured and the full numbers: [Demo load test](../development/demo-load-test.md).
