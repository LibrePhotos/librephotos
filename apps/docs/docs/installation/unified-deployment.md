---
title: "🚀 Unified Deployment"
excerpt: "Simplified single-container deployment without nginx proxy"
sidebar_position: 2
---

## Overview

The unified deployment is a simplified installation method that serves both the LibrePhotos API and frontend from a single Django container, eliminating the need for nginx proxy configuration.

### Benefits

- **Simplified setup**: No nginx configuration required
- **Single container**: Fewer moving parts, easier to manage
- **SSL-friendly**: Works seamlessly with reverse proxies like Traefik, Caddy, or cloud load balancers
- **Beginner-friendly**: Perfect for users who want a straightforward deployment

### When to Use

Choose unified deployment if you:
- Want the simplest possible setup
- Use external reverse proxies (Traefik, Caddy, cloud load balancers)
- Don't need nginx-specific optimizations
- Prefer fewer containers to manage

## 🐋 Docker Compose Installation

### Prerequisites

- Docker and Docker Compose installed
- At least 4GB RAM (ARM64 may be slower)
- 10GB+ disk space for images, thumbnails, and models

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/LibrePhotos/librephotos-docker.git
   cd librephotos-docker
   ```

2. **Create environment file**
   ```bash
   cp librephotos.env .env
   ```

3. **Edit configuration**
   ```bash
   nano .env
   ```
   
   Essential settings for unified deployment:
   ```env
   # Enable unified deployment
   SERVE_FRONTEND=true
   
   # Your photo directory
   scanDirectory=/path/to/your/photos
   
   # Database settings
   dbName=librephotos
   dbUser=postgres
   dbPass=your-secure-password
   
   # Web interface port
   httpPort=3000
   
   # For production with custom domain
   csrfTrustedOrigins=https://yourdomain.com
   ```

4. **Start LibrePhotos**
   ```bash
   docker-compose -f docker-compose.no-proxy.yml up -d
   ```

5. **Access LibrePhotos**
   - Open [http://localhost:3000](http://localhost:3000)
   - Create your admin account during first setup

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SERVE_FRONTEND` | Enable unified deployment | `false` | ✅ |
| `csrfTrustedOrigins` | Trusted domains for CSRF protection | - | For production |
| `httpPort` | Host port to expose | `3000` | ❌ |
| `scanDirectory` | Path to your photos | `/data` | ✅ |
| `dbPass` | Database password | - | ✅ |

For all environment variables, see [Environment Variables](environment-variables.md).

## 🌐 Reverse Proxy Setup

### Traefik

Add labels to your docker-compose:

```yaml
services:
  backend:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.librephotos.rule=Host(`photos.yourdomain.com`)"
      - "traefik.http.routers.librephotos.tls.certresolver=letsencrypt"
      - "traefik.http.services.librephotos.loadbalancer.server.port=8001"
```

### Caddy

Create a Caddyfile:

```
photos.yourdomain.com {
    reverse_proxy localhost:3000
}
```

### nginx

```nginx
server {
    listen 443 ssl;
    server_name photos.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 🔄 Migration from Standard Setup

Migrating from the standard Docker setup is straightforward:

1. **Stop current deployment**
   ```bash
   docker-compose down
   ```

2. **Backup your data** (recommended)
   ```bash
   # Backup database
   docker-compose exec db pg_dump -U postgres librephotos > backup.sql
   ```

3. **Update environment**
   Add to your `.env` file:
   ```env
   SERVE_FRONTEND=true
   csrfTrustedOrigins=https://yourdomain.com  # if using custom domain
   ```

4. **Switch to unified deployment**
   ```bash
   docker-compose -f docker-compose.no-proxy.yml up -d
   ```

Your data, photos, and settings will be preserved.

## 🔧 Troubleshooting

### CSRF Token Errors

If you encounter CSRF errors when accessing the web interface:

```env
# Add your domain(s) to trusted origins
csrfTrustedOrigins=https://yourdomain.com,https://www.yourdomain.com,http://localhost:3000
```

### Static Files Not Loading

Ensure the unified deployment is properly configured:
- Verify `SERVE_FRONTEND=true` in your environment
- Check container logs for any build errors
- Try rebuilding: `docker-compose pull && docker-compose up -d`

### API Endpoints Not Working

- API endpoints are available at `/api/*`
- Frontend is served from root `/`
- Check network connectivity and firewall settings

## 📊 Performance Notes

The unified deployment uses WhiteNoise for static file serving, which provides:
- Automatic compression (gzip/brotli)
- Far-future cache headers
- Efficient serving of CSS, JS, and images

For high-traffic deployments with many concurrent users, consider using an external reverse proxy like nginx for additional optimizations.

## Next Steps

After installation, see [First Steps](../user-guide/first-steps.md) to:
- Set up photo scanning
- Configure face recognition
- Explore the interface 