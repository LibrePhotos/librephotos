---
title: "📖 Advanced docker-compose usage"
excerpt: "Here are a couple of advanced tips"
sidebar_position: 5
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
| `FEATURE_VIDEO` | `featureVideo` | Video files are no longer imported. A scan skips them the same way it skips a file it cannot read, so no `Photo` is created and no video thumbnail is generated. |
| `FEATURE_FACE_DETECTION` | `featureFaceDetection` | No faces are extracted from photos. The face scan is left out of the scan pipeline and **Scan faces** in the UI answers with an error instead of starting a job. |
| `FEATURE_FACE_CLUSTER` | `featureFaceCluster` | Faces are still detected, but never grouped into people to label. Clustering is skipped at the end of a face scan and **Train faces** answers with an error. |
| `FEATURE_IMAGE_CAPTIONING` | `featureImageCaptioning` | No automatic captions are generated, neither during a scan nor from the "Generate caption" button on a photo. Captions you typed yourself are unaffected. |
| `FEATURE_REVERSE_GEOCODING` | `featureReverseGeocoding` | GPS coordinates are no longer turned into place names, so no requests go to your map provider. Photos keep their coordinates and still show up on the map; they just have no location text and cannot be searched by place. Searching for a place in the search bar still works. |
| `FEATURE_SCENE_CLASSIFICATION` | `featureSceneClassification` | Photos are no longer tagged by what is in them (beach, kitchen, sunset, ...), so the "Things" albums stay empty for new photos. |

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
There is one more switch of the same kind: `FEATURE_PROCESS_EMBEDDED_MEDIA` controls whether the motion video embedded in a "live photo" is extracted. It is listed in [Feature Toggles](../user-guide/feature-toggles.md) and only accepts the exact value `True`.
:::

### Hosting under a sub-path (subdirectory)

By default LibrePhotos is served from the root of a domain (e.g. `https://photos.example.com/`). If you need to host it under a sub-path instead (e.g. `https://example.com/photos/`), the frontend has to know that base path.

The frontend reads it from the `PUBLIC_URL` build-time variable (the alias `VITE_PUBLIC_URL` also works). It sets the base path used for the app's assets and routes and defaults to `/`.

Because it is applied when the frontend is **built**, the prebuilt images are served from `/`. To use a sub-path you need to build the frontend yourself with the variable set, for example:

```bash
# building the frontend directly
PUBLIC_URL=/photos/ yarn build
```

or by passing `PUBLIC_URL` into the frontend image build. Make sure your reverse proxy forwards the same sub-path (`/photos/`) to the frontend container.

:::note
Always include the trailing slash, e.g. `/photos/`, not `/photos`.
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

These are now site settings. If you set these values, they will act as the default on the first set-up.

```bash
# Comma delimited list of patterns to ignore (e.g. "@eaDir,#recycle" for synology devices)
skipPatterns=
# Allow uploading files
allowUpload=true
# Do you want to see on a map where all your photos where taken (if a location is stored in your photos)
# Get a Map box API Key https://account.mapbox.com/auth/signup/
mapApiKey=
# Username for the Administrator login.
userName=admin
# Password for the administrative user you set above.
userPass=admin
# Email for the administrative user.
adminEmail=admin@example.com
```
