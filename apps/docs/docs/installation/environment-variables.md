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

### Changing the container names

Follow the normal instructions as per your chosen build, but after updating the .env file to choose your container names, run

```bash
make rename
```

Then you can resume following the normal instructions.

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
