---
title: "Installation"
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

## 🐋 [Standard Docker Setup](standard-install.md)
**For advanced users and high-traffic deployments**

The traditional multi-container setup with separate nginx proxy. Choose this if you:
- Need nginx-specific features and optimizations
- Run high-traffic deployments
- Prefer the original architecture

## Platform-Specific Guides

- [Unraid Installation](unraid.md) - For Unraid NAS systems
