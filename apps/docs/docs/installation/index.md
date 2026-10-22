---
title: "Installation"
description: "How to install LibrePhotos: single-container, standard Docker, and platform-specific guides."
sidebar_position: 2
---

# Installation Methods

LibrePhotos offers two main installation methods to suit different deployment scenarios:

## 🚀 [Single Container Deployment](unified-deployment.md) 
**Recommended for most users**

A simplified single-container deployment that serves both the API and frontend from Django. This method supports both internal and external database configurations:

**With Internal Database (All-in-One):**
- Beginners wanting a simple setup
- Users with external reverse proxies (Traefik, Caddy, cloud load balancers)
- Deployments that don't require nginx-specific optimizations

**With External Database:**
- Cloud deployments with managed databases (RDS, Cloud SQL)
- Existing PostgreSQL infrastructure
- Simplified container management

:::note
<Since version="1.5.0" /> The unified image runs the machine learning models on an Intel, AMD or NVIDIA GPU like the standard setup does: give its container the same settings as the `backend` service in [Utilizing GPU Acceleration](environment-variables.md#utilizing-gpu-acceleration). Up to 1.4.0 it was CPU-only, and GPU acceleration needed the standard setup with the NVIDIA-only `reallibrephotos/librephotos-gpu` image.
:::

## 🐋 [Standard Docker Setup](standard-install.md)
**For advanced users and high-traffic deployments**

The traditional multi-container setup with separate nginx proxy. Choose this if you:
- Need nginx-specific features and optimizations
- Run high-traffic deployments
- Prefer the original architecture

## Platform-Specific Guides

- [Unraid Installation](unraid.md) - For Unraid NAS systems
- [Windows standalone](windows-standalone.md) - One folder with `librephotos.exe`, no Docker or Python
- [Kubernetes](https://github.com/LibrePhotos/librephotos/tree/dev/deploy/k8s#kubernetes-installation) - Kustomize manifests in `deploy/k8s`, with their own install and upgrade steps
