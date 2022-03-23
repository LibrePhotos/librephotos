---
title: "🌎 Advanced docker-compose usage"
excerpt: "Here are a couple of advanced tips"
last_modified_at: 2022-03-23
category: 1
---

### Changing the container names

Follow the normal instructions as per your chosen build, but after updating the .env file to choose your container names, run

```bash
make rename
```

Then you can resume following the normal instructions.

### Redis password

If the user wishes to re-use an existing instance of Redis that has password authentication, that user can set the Redis password in the backend by adding a new environment variable in the docker-compose file:

```bash
    environment:
        - REDIS_PASS=${password}
```

### Old environment variables

These are now site settings. If you set these values, they will act as the default on the first set up.

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
```
