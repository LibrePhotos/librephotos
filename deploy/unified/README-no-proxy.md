# LibrePhotos Unified Deployment

A simplified single-container deployment that serves both the API and frontend from Django, eliminating the need for nginx proxy configuration.

## Overview

This configuration removes the nginx proxy dependency by having Django serve both the API and the built React frontend directly using WhiteNoise.

### Benefits

- **Simplified deployment**: No nginx configuration needed
- **Single container**: Fewer moving parts, easier management  
- **Auto-SSL friendly**: Works with reverse proxies like Traefik, Caddy, or cloud load balancers
- **Direct port mapping**: Simple host:container port mapping

### How it Works

1. Frontend is built during Docker image creation and copied to Django static files
2. Django uses WhiteNoise to serve static files efficiently
3. URL routing: `/api/*` → Django API, everything else → React frontend
4. Simplified CORS since both are served from same origin

## Quick Start

```bash
# Use the no-proxy Docker Compose configuration
docker-compose -f docker-compose.no-proxy.yml up -d
```

**Key environment variable:**
```bash
SERVE_FRONTEND=true
```

## Available Images

Automatically built and published:
- **Development**: `reallibrephotos/librephotos-unified:dev`
- **Release**: `reallibrephotos/librephotos-unified:latest`
- **Multi-architecture**: AMD64 and ARM64 supported

## Configuration

### Essential Environment Variables

```bash
# Enable frontend serving
SERVE_FRONTEND=true

# Set trusted origins for CSRF protection (production)
CSRF_TRUSTED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Standard LibrePhotos configuration
SECRET_KEY=your-secret-key
DB_NAME=librephotos
DB_USER=postgres
DB_PASS=your-password
# ... other standard variables
```

### Reverse Proxy Examples

#### Traefik
```yaml
services:
  backend:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.librephotos.rule=Host(`photos.yourdomain.com`)"
      - "traefik.http.routers.librephotos.tls.certresolver=letsencrypt"
      - "traefik.http.services.librephotos.loadbalancer.server.port=8001"
```

#### Caddy
```
photos.yourdomain.com {
    reverse_proxy localhost:3000
}
```

## Migration from Standard Setup

1. **Backup data**: Database and photos
2. **Switch compose file**: Use `docker-compose.no-proxy.yml`
3. **Add environment**: Set `SERVE_FRONTEND=true`
4. **Update CSRF**: Set `CSRF_TRUSTED_ORIGINS` for your domain(s)
5. **Deploy**: `docker-compose -f docker-compose.no-proxy.yml up -d`

## Troubleshooting

### CSRF Errors
Ensure `CSRF_TRUSTED_ORIGINS` includes your domain:
```bash
CSRF_TRUSTED_ORIGINS=https://yourdomain.com,http://localhost:3000
```

### Static Files Not Loading
Verify `SERVE_FRONTEND=true` is set and container includes frontend build.

### API Not Responding
API endpoints are still at `/api/*`. Check requests are properly prefixed.

## Building Custom Images

### Automated (Recommended)
Images are built automatically via GitHub Actions on pushes and releases.

### Manual Build
```bash
cd librephotos-docker
./build-unified.sh [tag]
```

Or directly:
```bash
cd librephotos-docker/unified
docker build -t my-librephotos-unified .
```

## Backwards Compatibility

This setup is fully backwards compatible with the standard proxy setup. Users can choose between deployment methods without breaking existing installations. 