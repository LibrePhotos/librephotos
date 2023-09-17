---
title: "📖 Advanced docker-compose usage"
excerpt: "Here are a couple of advanced tips"
sidebar_position: 5
---

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
# Number of workers, when scanning pictures. This setting can dramatically affect the ram usage.
# Each worker needs 800MB of RAM. Change at your own will. Default is 1.
HEAVYWEIGHT_PROCESS=1
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
