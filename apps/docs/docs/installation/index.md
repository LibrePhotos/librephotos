---
title: "Installation"
sidebar_position: 2
---

# Installation Methods

LibrePhotos offers three main installation methods to suit different deployment scenarios:

## 🚀 [Unified Deployment](unified-deployment.md) 
**Recommended for most users**

A simplified single-container deployment that serves both the API and frontend from Django. Perfect for:
- Beginners wanting a simple setup
- Users with external reverse proxies (Traefik, Caddy, cloud load balancers)
- Deployments that don't require nginx-specific optimizations

**Key features:**
- Single container to manage
- No nginx configuration needed
- SSL-friendly with external proxies
- Automatic static file optimization

## 🐳 [Single Container Deployment](single-container.md)
**For external database setups**

Run LibrePhotos as a single unified container while connecting to an external PostgreSQL database. Ideal for:
- Cloud deployments with managed databases
- Existing PostgreSQL infrastructure
- Kubernetes or container orchestration platforms
- Simplified container management

## 🐋 [Standard Docker Setup](standard-install.md)
**For advanced users and high-traffic deployments**

The traditional multi-container setup with separate nginx proxy. Choose this if you:
- Need nginx-specific features and optimizations
- Have complex reverse proxy requirements
- Run high-traffic deployments
- Prefer the original architecture

**Key features:**
- Dedicated nginx container for static files
- Separate frontend and backend containers
- Maximum performance for media serving
- Full nginx configuration control

## Which Should I Choose?

| Scenario | Recommended Method |
|----------|-------------------|
| First-time installation | [Unified Deployment](unified-deployment.md) |
| Using Traefik/Caddy | [Unified Deployment](unified-deployment.md) |
| Cloud deployment (AWS/GCP/Azure) | [Single Container](single-container.md) |
| Managed database (RDS, Cloud SQL) | [Single Container](single-container.md) |
| Existing PostgreSQL server | [Single Container](single-container.md) |
| Kubernetes deployment | [Single Container](single-container.md) |
| Simple home server | [Unified Deployment](unified-deployment.md) |
| High-traffic production | [Standard Docker](standard-install.md) |
| Complex nginx requirements | [Standard Docker](standard-install.md) |
| Existing nginx setup | [Standard Docker](standard-install.md) |

## Platform-Specific Guides

- [Unraid Installation](unraid.md) - For Unraid NAS systems

## Need Help?

If you're unsure which method to choose, start with the [Unified Deployment](unified-deployment.md) - you can always migrate to the standard setup later if needed.
