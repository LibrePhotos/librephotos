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
The unified image is CPU-only. It is built on the CPU base image, and no GPU-enabled unified image is published. If you want NVIDIA GPU acceleration, use the [Standard Docker Setup](standard-install.md) instead, where the `backend` service is swapped to the `reallibrephotos/librephotos-gpu` image (see [Utilizing GPU Acceleration](environment-variables.md#utilizing-gpu-acceleration)).
:::

## 🐋 [Standard Docker Setup](standard-install.md)
**For advanced users and high-traffic deployments**

The traditional multi-container setup with separate nginx proxy. Choose this if you:
- Need nginx-specific features and optimizations
- Run high-traffic deployments
- Want NVIDIA GPU acceleration (see [Utilizing GPU Acceleration](environment-variables.md#utilizing-gpu-acceleration) — x86 only)
- Prefer the original architecture

## Platform-Specific Guides

- [Unraid Installation](unraid.md) - For Unraid NAS systems
