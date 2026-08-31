---
title: "📖 Advanced docker-compose usage"
description: "Here are a couple of advanced tips"
sidebar_position: 4
---

### PostgreSQL v18+ Volume Mount Change

:::warning Breaking Change
With Postgres v18+, mounting a volume to `/var/lib/postgresql/data` can fail in Docker/Kubernetes due to an upstream change that enforces a new data directory (`/var/lib/postgresql/MAJOR/docker`) and adds a symlink from `/var/lib/postgresql/data` to `/var/lib/postgresql`.

**Action required:** Mount your volume to `/var/lib/postgresql` instead of `/var/lib/postgresql/data`. `pgautoupgrade` will detect any existing data there and migrate it to the new structure.
:::

### Utilizing GPU Acceleration

To leverage GPU acceleration for neural networks and face detection, follow these steps:

1. **Update NVIDIA GPU Driver:**
   Ensure you have the latest NVIDIA GPU driver installed on your system. You can download and install it from the official NVIDIA website.

2. **Install NVIDIA Container Toolkit:**
   Install the NVIDIA Container Toolkit, which enables GPU support within Docker containers. You can do this by running the following command:

   ```shell
   sudo apt install nvidia-container-toolkit
   ```

3. **Update Docker Compose Configuration:**
   Modify your `docker-compose.yml` file to specify the `reallibrephotos/librephotos-gpu` image as the backend for your application. Locate the relevant service definition for your backend, and update it to use the GPU-enabled image. For example:

   ```yaml
   services:
     backend:
       image: reallibrephotos/librephotos-gpu:${tag}
       # ... other configuration settings ...
   ```

4. **Configure GPU Resources in Docker Compose:**
   Add a `deploy` section to your Docker Compose file to allocate GPU resources to the backend service. Ensure you specify the correct GPU driver, count, and capabilities. Here's an example of how to do this:
   ```yaml
   services:
     backend:
       image: reallibrephotos/librephotos-gpu:${tag}
       # ... other configuration settings ...
       deploy:
         resources:
           reservations:
             devices:
               - driver: nvidia
                 count: 1
                 capabilities: [gpu]
   ```

:::note
The GPU image is only available for x86 architecture. ARM is not supported for the GPU image.
:::

### Limiting CPU and memory usage

The backend container runs two things: **gunicorn**, which answers API requests, and a pool of **background workers**, which scan your library — thumbnails, face detection, captioning. Almost all of the CPU and memory LibrePhotos uses goes to the background workers, and by default there is **one worker per CPU core**.

#### Start with the worker count, not a CPU limit

The instinct is to cap the container in `docker-compose.yml`:

```yaml
services:
  backend:
    cpus: 0.8
```

On its own this usually backfires. A `cpus:` limit throttles the container, but it does not change how many workers LibrePhotos starts — the worker pool is sized from the number of cores the *host* reports, which a `cpus:` limit does not change. You end up with just as many workers competing for a fraction of the CPU, and the first thing to break is the API: a request that takes longer than gunicorn's timeout gets its worker killed, and the backend log fills with

```
[ERROR] Worker (pid:113) was sent SIGKILL! Perhaps out of memory?
```

That message is gunicorn's generic text for a killed worker. On a CPU-capped host it almost always means the request was too slow, **not** that the machine ran out of memory.

So set the worker count instead. In your `.env`:

```bash
# One background worker instead of one per core
workerConcurrency=1
```

This is the setting that actually gives resources back to the rest of the machine. Scanning takes longer, but the API stays responsive and nothing gets killed. Each worker is recycled once it passes roughly 300 MB of resident memory, so the worker count is also the main lever on the backend's memory footprint.

#### If you also want a hard cap

Once the worker count is sensible, a container limit is a reasonable backstop. Raise the API timeout at the same time so throttled requests are not killed mid-flight:

```bash
workerConcurrency=1
# Seconds before gunicorn kills a request (default 30)
gunicornTimeout=120
```

```yaml
services:
  backend:
    cpus: 2.0
    mem_limit: 4g
```

`cpuset` works too, if you would rather pin LibrePhotos to specific cores than give it a fraction of all of them:

```yaml
services:
  backend:
    cpuset: "0-2"
```

Under Docker Swarm the equivalent is a `deploy.resources` block:

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 4G
```

:::note
`cpu_shares` only sets a *relative* priority between containers and has no visible effect when nothing else is competing for the CPU, which is why it often looks like it does nothing.
:::

:::warning
Do not cap the container so hard that the first scan cannot finish. Face detection and captioning load sizeable models; below roughly 2 GB of memory the backend will be killed by the kernel — and *that* really is an out-of-memory kill.
:::

### Turning features off

Every part of the library scan that costs real CPU, memory or network can be switched off at deploy time with a `FEATURE_*` environment variable. All of them default to **on**, so an upgrade changes nothing until you set one.

Accepted "on" values are `true`, `1`, `yes` and `on` (any capitalisation); anything else counts as off.

| Variable | `.env` key | What turning it off stops |
| --- | --- | --- |
| `FEATURE_VIDEO` | `featureVideo` | Video files are no longer imported. A scan skips them the same way it skips a file it cannot read, so no `Photo` is created and no video thumbnail is generated. The motion video inside a "live photo" is not extracted either, so those stay ordinary still images. |
| `FEATURE_FACE_DETECTION` | `featureFaceDetection` | No faces are extracted from photos, neither during a scan nor when you upload one. The face scan is left out of the scan pipeline and **Scan faces** in the UI reports an error instead of starting a job. The face recognition service is not started, so its model is never loaded. |
| `FEATURE_FACE_CLUSTER` | `featureFaceCluster` | Faces are still detected, but never grouped into people to label. Clustering is skipped at the end of a face scan and **Train faces** reports an error. |
| `FEATURE_IMAGE_CAPTIONING` | `featureImageCaptioning` | No automatic captions are generated, neither during a scan nor from the "Generate caption" button on a photo. Captions you typed yourself are unaffected. Neither the captioning service nor the LLM service is started — the LLM is only ever used to write and polish captions, so it has nothing left to do. |
| `FEATURE_REVERSE_GEOCODING` | `featureReverseGeocoding` | GPS coordinates are no longer turned into place names, so no requests go to your map provider. Photos keep their coordinates and still show up on the map of an album and of a single photo, but without a place name they do not appear on the Places page, get no Places album, and cannot be searched by place. Searching for a place in the search bar still works. |
| `FEATURE_SCENE_CLASSIFICATION` | `featureSceneClassification` | Photos are no longer tagged by what is in them (beach, kitchen, sunset, ...), so the "Things" albums stay empty for new photos. The tagging service is not started, so the places365 model is never loaded. |
| `FEATURE_PROCESS_EMBEDDED_MEDIA` | `featureProcessEmbeddedMedia` | The short video stored inside a "live photo" or motion photo is no longer extracted, so those files stay ordinary stills. `FEATURE_VIDEO` has to be on as well for extraction to happen. See [Feature Toggles](../user-guide/feature-toggles.md) for the one way this switch differs from the others. |

Turning a feature off never deletes anything that was already generated - the existing captions, faces and place names stay in the database and remain visible. Turning it back on picks up where the scan left off.

With the bundled Compose setup, set the lowerCamelCase keys in your `.env`:

```bash
# A machine without much CPU: keep the photos, skip the machine learning
featureFaceDetection=false
featureFaceCluster=false
featureImageCaptioning=false
featureSceneClassification=false
```

If you run your own Compose file or Kubernetes manifests, pass the `FEATURE_*` names to the backend container directly:

```yaml
services:
  backend:
    environment:
      - FEATURE_VIDEO=false
```

:::note
`FEATURE_PROCESS_EMBEDDED_MEDIA` is checked only at the moment a file is first imported. Turning it on for a library that has already been scanned extracts nothing for the photos already there — not even with **Rescan All Photos** — so only files added afterwards are affected.
:::

#### The machine learning services follow the switches

:::note
This part is not in a released image yet. It is available on the `dev` branch and will appear in the next release; on 1.1.0 the switches stop the processing, but the services still start.
:::

The backend runs its heavy models in separate sidecar processes, and a watchdog restarts any of them that dies. A switch that is off keeps its service from being started at all, and the watchdog leaves it alone rather than bringing it back a minute later — which is where the memory saving actually comes from, since a loaded model costs its memory whether or not anything asks it a question.

| Switch | Service that stops being started |
| --- | --- |
| `FEATURE_FACE_DETECTION` | `face_recognition` |
| `FEATURE_IMAGE_CAPTIONING` | `image_captioning`, `llm` |
| `FEATURE_SCENE_CLASSIFICATION` | `tags` |

The remaining services — `exif`, `thumbnail`, `ocr`, `clip_embeddings` and `image_similarity` — carry the scanning and search that the rest of LibrePhotos is built on, so they have no switch and always run. The other feature flags (`FEATURE_VIDEO`, `FEATURE_FACE_CLUSTER`, `FEATURE_REVERSE_GEOCODING`, `FEATURE_PROCESS_EMBEDDED_MEDIA`) gate work that happens inside the backend itself and have no service of their own to stop.

A skipped service is named once in the backend log at startup, so `docker logs backend` tells you why something is not running. The Admin Area's **Services** list shows one as **Disabled** rather than as unhealthy, and offers no Start button for it.

### Cached video conversions

A user who turns on **Always transcode videos** (Settings → Experimental) has videos in containers or codecs their browser cannot decode converted as they play. A conversion happening live has no known length, so it carries no `Content-Length` and no `Accept-Ranges`, and it cannot be sought at all — no duration, no scrub bar, no skipping. The same conversion is therefore written to a file once, and every later play of that video is served from the file instead, as an ordinary seekable mp4. The first play still streams live and starts exactly as quickly as it does today: the copy is written **after** that stream ends, never alongside it, because the live conversion has to keep ahead of playback and would lose a share of the machine to a second ffmpeg. The copy is also niced and limited to half the cores, so playback, thumbnails and a running scan all outrank it.

The cache costs somewhere between 10 and 20 MB per minute of video — how much movement there is in the footage decides where in that range it lands — and only for the videos somebody actually opens with that setting on. If nobody turns it on, nothing is ever written.

| Variable | `.env` key | Default | What it does |
| --- | --- | --- | --- |
| `TRANSCODE_CACHE_MAX_GB` | `transcodeCacheMaxGb` | `10` | How large the cache may grow, in GB. Roughly an hour of video per GB. Set it to `0` to switch caching off entirely and keep only the live streaming. |
| `TRANSCODE_CACHE_MIN_FREE_GB` | `transcodeCacheMinFreeGb` | `2` | How much free space to leave alone on the volume, in GB. The cache never writes into this, and a conversion already running is abandoned if the free space drops into it. |
| `TRANSCODE_CACHE_MAX_CONCURRENT` | `transcodeCacheMaxConcurrent` | `1` | How many conversions may be written at once. Each is an ffmpeg process, so raising this trades CPU for having more videos become seekable sooner. |
| `TRANSCODE_CACHE_NICE` | `transcodeCacheNice` | `10` | How far the background conversion stands back from everything else, as a `nice` value. `0` turns the courtesy off. |

When either ceiling is reached, the least recently played entries are deleted until the new one fits; if even that is not enough, the video simply is not cached and plays live as before. Nothing is ever served before its conversion has finished, so an interrupted one leaves no half-playable file behind.

The files live under `protected_media/transcoded/`, named by image hash, and are deleted along with the photo. Deleting the directory by hand is safe at any time — it costs only the CPU to convert those videos again.

### Logging

The backend writes its log files into the directory named by `BASE_LOGS`. `ownphotos.log` is the one to look at first; it is also downloadable from the Admin Area (see [Internal files](../user-guide/internal-files.md) and [Library](../user-guide/library.md)).

| Variable | Default | What it does |
| --- | --- | --- |
| `BASE_LOGS` | `/logs/` | Directory the log files are written to. It is created on startup if it is missing; if it cannot be created the backend stops with an error naming the path it tried, rather than starting up with no log at all. With the bundled Compose setup you do not need to set this - the path inside the container is fixed at `/logs`, and the host directory behind it follows `data` from your `.env` (`${data}/logs:/logs`). Set it when you run the backend outside that setup, for example directly on the host. |
| `LOG_LEVEL` | `INFO` | Lowest level that gets written. One of `CRITICAL`, `ERROR`, `WARNING`, `INFO`, `DEBUG`. An unrecognised value falls back to `INFO` and says so in the log. |
| `LOG_TO_CONSOLE` | `1` | Also send the log to the container's standard output, where `docker logs backend` (or `kubectl logs`) can read it. Set it to `0` to write only the file. Accepted "on" values are the same as for the feature switches above. |

`LOG_LEVEL=DEBUG` adds per-photo and per-request detail. That is what you want while reproducing a bug, but on a large library the file grows quickly - put it back afterwards.

Keep `LOG_TO_CONSOLE` on if the log directory does not survive a restart. On Kubernetes `/logs` is often an `emptyDir`, and then standard output is the only copy of the log that outlives the pod.

None of the three is in the bundled `.env` file; pass them to the backend container directly:

```yaml
services:
  backend:
    environment:
      - LOG_LEVEL=DEBUG
```

:::warning
`secret.key` lives in `BASE_LOGS`, next to the log files. Zipping that whole folder for a bug report hands out your Django secret key, which is what every session and token on your instance is signed with. Attach `ownphotos.log` by itself instead. Deleting `secret.key` is not a fix either - it logs every user out and the passwords have to be reset.
:::

### Telling LibrePhotos its own public address

`FRONTEND_BASE_URL` is the URL your users actually browse to, for example `https://photos.example.com` (no trailing slash). Leave it unset and LibrePhotos falls back to the origin each request appears to have arrived on.

That fallback is wrong behind the bundled proxy, which forwards `/api/` to the backend with the `Host` header rewritten to `backend` — a name that only resolves inside the Docker network. The rewrite is deliberate (it means Django's host validation passes whatever domain you use), but it does mean the backend cannot work out its own public address on its own.

So set this whenever LibrePhotos has to hand a URL to something outside the container:

- **Password-reset emails** — the link in the email. Without it the fallback can produce a link pointing at `http://backend/...`, which no mail recipient can open.
- **Single sign-on** — the OAuth `redirect_uri` sent to your identity provider, which the browser has to follow and the provider has to recognise. SSO refuses to start rather than send a broken one, so this is effectively required for [OIDC](../user-guide/settings/single-sign-on.md).

### Hosting under a sub-path (subdirectory)

By default LibrePhotos is served from the root of a domain (e.g. `https://photos.example.com/`). If you need to host it under a sub-path instead (e.g. `https://example.com/photos/`), the frontend has to know that base path.

The frontend reads it from the `VITE_PUBLIC_URL` build-time variable. It sets the base path the app's static assets are loaded from and the prefix its API calls are made against, and defaults to `/`. (`PUBLIC_URL` is also read by `vite.config.ts`, but only for the asset paths — set it on its own and the app's API calls still point at the domain root and fail, so use `VITE_PUBLIC_URL`.)

Because it is applied when the frontend is **built**, the prebuilt images are served from `/`. To use a sub-path you need to build the frontend yourself with the variable set, for example:

```bash
# building the frontend directly
VITE_PUBLIC_URL=/photos yarn build
```

:::note
Do not add a trailing slash: use `/photos`, not `/photos/`. The app joins this value directly with `/api` and `/login`, so a trailing slash produces doubled paths such as `/photos//api`. Vite adds the slash it needs for the asset URLs on its own.
:::

The bundled proxy — not the frontend container — is the one published to the host (on `httpPort`, `3000` by default), and its nginx config matches `/api`, `/media` and the other backend paths anchored at the root. So an outer reverse proxy has to strip the sub-path before handing requests on to it, for example:

```nginx
location /photos/ {
  # the trailing slash on proxy_pass strips the /photos/ prefix
  proxy_pass http://127.0.0.1:3000/;
}
```

Alternatively, re-anchor the location blocks in `deploy/docker/proxy/nginx.conf` under the sub-path yourself.

:::warning
Sub-path hosting is not fully working today. `VITE_PUBLIC_URL` re-bases the assets and the API calls, but the client-side router (`apps/frontend/src/App.tsx`) is created without a matching base path, so once the app has loaded its in-browser routes are still matched against root-relative paths and navigation breaks. Fixing this needs a change in the frontend, not just the build variable.
:::

### Changing the container names

Container names are set directly in `docker-compose.yml` through the `container_name` keys (`proxy`, `db`, `frontend` and `backend`). Edit those values if you want different names, for example when running more than one LibrePhotos stack on the same host:

```yaml
services:
  backend:
    container_name: myphotos-backend
```

These are the names you pass to `docker exec`, `docker logs` and similar commands.

They are separate from the **service** names — the `proxy:`, `db:`, `frontend:` and `backend:` keys themselves — which the containers use to reach each other over the Compose network. The bundled proxy resolves `frontend` and `backend` by service name, so leave those keys as they are.

:::note
Older guides mention a `make rename` helper that rewrote these names from your `.env` file. It was removed together with `deploy/Makefile`; edit `docker-compose.yml` directly instead.
:::

### Old environment variables

These are now site settings: setting them here only supplies the default used on the first set-up, after which the value lives in the site settings and any change you make there takes precedence.

```bash
# Comma delimited list of patterns to ignore (e.g. "@eaDir,#recycle" for synology devices)
skipPatterns=
# Allow uploading files
allowUpload=true
# API key for the geocoding map provider. Only needed if you switch the provider
# to Mapbox, MapTiler, TomTom or OpenCage; the default, Nominatim (OpenStreetMap),
# needs no key.
mapApiKey=
```

### Admin account variables

`userName`, `userPass` and `adminEmail` are **not** site settings. They are still live environment variables, wired to `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `ADMIN_EMAIL` in `docker-compose.yml`:

```bash
# Username for the Administrator login.
userName=admin
# Password for the administrative user you set above.
userPass=admin
# Email for the administrative user.
adminEmail=admin@example.com
```

Whenever `userName` is set, the backend entrypoint runs `createadmin` on **every** container start:

- On the first start it creates the superuser. The username is lower-cased, and `adminEmail` is used for the account.
- On every later start the existing user's password is overwritten with `userPass`. Leaving `userPass` set therefore resets the admin password on each restart — a password you changed in the UI will not survive a `docker compose restart`. This is the same behaviour described under [How to change the admin password, when you can't log in](../user-guide/managing-users.md#how-to-change-the-admin-password-when-you-cant-log-in).
- `adminEmail` is only applied when the account is first created; on later starts `createadmin` ignores it and logs a warning.

To stop the password from being reset, clear `userName` — that skips `createadmin` entirely. Clearing only `userPass` while leaving `userName` set instead makes the command abort on each start with "Admin password cannot be empty".
