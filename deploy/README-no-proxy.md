# LibrePhotos No-Proxy Deployment

This configuration removes the nginx proxy dependency by having Django serve both the API and the built React frontend directly.

## Benefits

- **Simplified deployment**: No need to configure nginx for SSL/domains
- **Single container**: Fewer moving parts and easier management
- **Auto-SSL friendly**: Works seamlessly with reverse proxies like Traefik, Caddy, or cloud load balancers
- **Direct port mapping**: Simply map host port to container port 8001

## How it Works

1. **Build process**: The frontend is built during Docker image creation and copied into the Django static files directory
2. **Static file serving**: Django uses WhiteNoise to efficiently serve static files (including the React app)
3. **URL routing**: All `/api/*` requests go to Django API, everything else serves the React frontend
4. **CORS handling**: Simplified since frontend and backend are served from the same origin

## Available Images

The unified images are automatically built and published:

- **Development builds**: `reallibrephotos/librephotos-unified:dev` (built from main branch)
- **Release builds**: `reallibrephotos/librephotos-unified:latest` or `reallibrephotos/librephotos-unified:v1.2.3`
- **Multi-architecture**: Both AMD64 and ARM64 supported

## Usage

### Quick Start

Use the no-proxy Docker Compose configuration:

```bash
# Copy the environment file
cp librephotos.env.example librephotos.env

# Edit your settings
vim librephotos.env

# Start with no-proxy configuration
docker-compose -f docker-compose.no-proxy.yml up -d
```

### Environment Variables

The key difference is setting `SERVE_FRONTEND=true`:

```bash
# In your librephotos.env or docker-compose.yml
SERVE_FRONTEND=true

# Set your domain for CSRF protection (important for production)
CSRF_TRUSTED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

### SSL/Domain Setup

Since there's no nginx to configure, you can use any reverse proxy:

#### With Traefik
```yaml
services:
  backend:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.librephotos.rule=Host(`photos.yourdomain.com`)"
      - "traefik.http.routers.librephotos.tls.certresolver=letsencrypt"
      - "traefik.http.services.librephotos.loadbalancer.server.port=8001"
```

#### With Caddy
```
photos.yourdomain.com {
    reverse_proxy localhost:3000
}
```

#### With nginx (as external reverse proxy)
```nginx
server {
    listen 443 ssl;
    server_name photos.yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Important Differences

### Port Mapping
- **With proxy**: Host port 3000 → nginx:80 → frontend:3000 + backend:8001
- **No proxy**: Host port 3000 → backend:8001 (serves both frontend and API)

### URLs
- **API endpoints**: Still available at `/api/*`
- **Frontend**: Served from root `/`
- **Static files**: Served from `/static/`
- **Media files**: Still served from `/media/`

### Performance Considerations

- **Static files**: WhiteNoise provides excellent performance for static files with compression and caching
- **Media files**: Large photo files still benefit from nginx's X-Accel-Redirect. For high-traffic deployments, consider adding nginx as an external reverse proxy for media files only

## Migration from Proxy Setup

To migrate from the existing proxy setup:

1. **Backup your data**: Always backup your database and photos first
2. **Update docker-compose**: Switch to `docker-compose.no-proxy.yml`
3. **Set environment**: Add `SERVE_FRONTEND=true` to your environment
4. **Update CSRF origins**: Set `CSRF_TRUSTED_ORIGINS` to your domain(s)
5. **Deploy**: `docker-compose -f docker-compose.no-proxy.yml up -d`

## Troubleshooting

### CSRF Errors
If you get CSRF errors, make sure `CSRF_TRUSTED_ORIGINS` includes your domain:
```bash
CSRF_TRUSTED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com,http://localhost:3000
```

### Static Files Not Loading
Check that `SERVE_FRONTEND=true` is set and the container has been rebuilt with the frontend build included.

### API Not Working
The API is still available at `/api/*`. If you're getting 404s, check that your requests are properly prefixed with `/api/`.

## Building Custom Images

### Automated Builds (Recommended)
Images are automatically built via GitHub Actions:
- **Dev builds**: Triggered on pushes to main branch
- **Release builds**: Triggered on GitHub releases
- **Multi-arch**: AMD64 and ARM64 support

### Manual Build
To build your own unified image:

```bash
cd librephotos-docker
./build-unified.sh [tag]
```

Or directly with Docker:

```bash
cd librephotos-docker/unified
docker build -t my-librephotos-unified .
```

The build process will:
1. Clone and build the frontend
2. Install the backend with WhiteNoise
3. Copy frontend build to backend static directory
4. Set up the unified entrypoint script

## Backwards Compatibility

This no-proxy setup is **fully backwards compatible**:
- Existing proxy setup (`docker-compose.yml`) continues to work unchanged
- Users can choose between proxy or no-proxy deployments
- No breaking changes to existing installations 