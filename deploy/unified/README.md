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

### Docker Compose (Recommended)
```bash
# Use the no-proxy Docker Compose configuration
docker-compose -f docker-compose.no-proxy.yml up -d
```

### Docker Run (SQLite)
For a simple single-container deployment with SQLite database:

```bash
# Create data directory structure
mkdir -p ./librephotos-data/{db,internal_media,logs}

# Run container
docker run -d \
  --name librephotos \
  -p 3000:8001 \
  -v ./librephotos-data/db:/db \
  -v ./librephotos-data/internal_media:/protected_media \
  -v ./librephotos-data/logs:/logs \
  -v /path/to/your/photos:/data \
  -e SERVE_FRONTEND=true \
  -e DB_BACKEND=sqlite \
  reallibrephotos/librephotos-unified:latest
```

Replace `/path/to/your/photos` with the actual path to your photo collection.

**Directory Structure Created:**
- `./librephotos-data/db/` - SQLite databases (`librephotos.sqlite3`, `cache.sqlite3`)
- `./librephotos-data/protected_media/` - Processed images, thumbnails, and model data
- `./librephotos-data/logs/` - Application logs, Secret Key

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

# Database backend (sqlite or postgresql)
DB_BACKEND=sqlite

# Set trusted origins for CSRF protection (production)
CSRF_TRUSTED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Standard LibrePhotos configuration
SECRET_KEY=your-secret-key
DB_NAME=librephotos
DB_USER=postgres
DB_PASS=your-password
# ... other standard variables
```

## Migration from Standard Setup

1. **Backup data**: Database and photos
2. **Switch compose file**: Use `docker-compose.no-proxy.yml`
3. **Add environment**: Set `SERVE_FRONTEND=True`
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

### Container Won't Start
Check logs with:
```bash
docker logs librephotos
```

Common issues:
- Missing required environment variables
- Incorrect volume mounts
- Port conflicts

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
