---
title: "Development"
sidebar_position: 4
---

## Architecture

Currently the setup is split up into for different containers. In this document the general architecture and reason for the components will be explained

### Backend

The Backend uses Django as a Framework. Everything the generally applies to Django can be applied to LibrePhotos. If there is some feature that is in Django, but not yet in LibrePhotos, then this would be quite easy to add.

In general there are four process running in the backend.

- As a Webserver and for the handling of general API calls we use Gunicorn. Scaling works here with the worker argument Gunicorn provides-
- For long running jobs we use django_q2 with ORM settings. Scaling works here with the HEAVYWORKER env variable.
- A image similarity service is also hosted, which uses faiss. If you want to get similar images or if you want to search semantically, this is needed.
- A thumbnail service, which generates thumbnails. Pretty selfexplanatory, is only used, because pytorch and imagemagick do not play nice together.

### Frontend

Pretty simple container. In production this is just a static webserver with the build frontend project. The dev version installs the right packages with the right node versions to seamlessly work.

### Proxy

We use a reverse proxy to handle traffic from outside to the frontend and backend. We use NGNIX for it. Serving actual images and videos is also done with NGINX, because it is better at it then Django.

### Database

This is usually Postgres, but maybe could be different databases in the future. However there are still two or three features depending on Postgres running.
