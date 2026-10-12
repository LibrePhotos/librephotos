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

### Docker Compose (PostgreSQL)
The compose file is `deploy/compose/docker-compose.unified.yml`. It reads the same `.env` file as the standard `docker-compose.yml`:

```bash
cd librephotos/deploy/compose
cp librephotos.env .env   # then edit scanDirectory, data and the rest
docker compose -f docker-compose.unified.yml up -d
```

#### Upgrading from `docker-compose.no-proxy.yml`

Releases up to 1.3.0 kept this file as `deploy/docker/unified/docker-compose.no-proxy.yml` and mounted the database directory `${data}/dbcursor` at `/var/lib/postgresql/data`. The new file mounts the same directory at `/var/lib/postgresql`, which Postgres 18 needs. On the first start `pgautoupgrade` finds the old cluster at the top of `dbcursor/` and moves it into `dbcursor/18/docker` (upgrading it to Postgres 18 if it is older). Back up `${data}/dbcursor` first, then:

```bash
docker compose -f docker-compose.no-proxy.yml down    # with the old file
cd librephotos/deploy/compose
cp librephotos.env .env                               # if you have no .env there yet; copy your values over
docker compose -f docker-compose.unified.yml up -d
docker logs db                                        # wait for "database system is ready to accept connections"
```

### Docker Run (SQLite)
For a simple single-container deployment with SQLite database:

```bash
# Create data directory structure
mkdir -p ./librephotos-data/{db,protected_media,logs}

# Run container
docker run -d \
  --name librephotos \
  -p 3000:8001 \
  -v ./librephotos-data/db:/db \
  -v ./librephotos-data/protected_media:/protected_media \
  -v ./librephotos-data/logs:/logs \
  -v /path/to/your/photos:/data \
  -e SERVE_FRONTEND=true \
  -e DB_BACKEND=sqlite \
  reallibrephotos/librephotos-unified:latest
```

Replace `/path/to/your/photos` with the actual path to your photo collection.

**Directory Structure Created:**
- `./librephotos-data/db/` - SQLite databases (`librephotos.sqlite3`, `cache.sqlite3`)
- `./librephotos-data/protected_media/` - Processed images, thumbnails, model data and `secret.key` (unless you pass `SECRET_KEY`)
- `./librephotos-data/logs/` - Application logs

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
2. **Stop the stack**: `docker compose down` in `deploy/compose`
3. **Move the database**: the standard file keeps it in `${data}/db`, the unified one in `${data}/dbcursor`; rename the directory
4. **Switch compose file**: Use `deploy/compose/docker-compose.unified.yml` with the same `.env` (it already sets `SERVE_FRONTEND=true`)
5. **Update CSRF**: Set `csrfTrustedOrigins` in `.env` for your domain(s)
6. **Deploy**: `docker compose -f docker-compose.unified.yml up -d`

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
Build from the monorepo root, which is the build context (this is what CI does):
```bash
cd librephotos
docker build -t my-librephotos-unified -f deploy/docker/unified/Dockerfile .
```

## Backwards Compatibility

This setup is fully backwards compatible with the standard proxy setup. Users can choose between deployment methods without breaking existing installations. 
