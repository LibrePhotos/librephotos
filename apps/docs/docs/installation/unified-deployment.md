---
title: "🚀 Single Container Deployment"
excerpt: "Simplified single-container deployment with internal or external database"
sidebar_position: 2
---

## Overview

Single container deployment serves both the LibrePhotos API and frontend from one unified container. Choose between internal database (SQLite) or external PostgreSQL.

## 🐋 Option 1: All-in-One (SQLite Database)

**Best for: Simple home servers, quick testing, first-time users**

### Quick Start

1. **Create directories for data**
   ```bash
   mkdir -p /home/yourusername/librephotos/{db,protected_media,logs}
   ```

2. **Start LibrePhotos**
   ```bash
   sudo docker run -d \
     --name librephotos \
     --restart unless-stopped \
     -p 3000:8001 \
     -v /home/yourusername/librephotos/db:/db \
     -v /home/yourusername/librephotos/protected_media:/protected_media \
     -v /home/yourusername/librephotos/logs:/logs \
     -v /path/to/your/photos:/data \
     -e SERVE_FRONTEND=true \
     -e DB_BACKEND=sqlite \
     reallibrephotos/librephotos-unified:latest
   ```

3. **Access**: [http://localhost:3000](http://localhost:3000)


**Notes:**
- **Secret key**: Optional - if not provided, one will be generated and saved to `/logs/secret_key.txt`
- **Database**: SQLite file will be created automatically in the `/db` directory
- **Photos**: Mount your photo directory as read-only if preferred: `-v /path/to/photos:/data:ro`

## 🗄️ Option 2: External PostgreSQL Database

**Best for: Cloud deployments, existing PostgreSQL, production setups**

### 1. PostgreSQL Setup

**Existing PostgreSQL:**
```sql
CREATE DATABASE librephotos;
CREATE USER librephotos_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE librephotos TO librephotos_user;
```

**New PostgreSQL container:**
```bash
sudo docker run -d \
  --name librephotos-db \
  --restart unless-stopped \
  -p 5432:5432 \
  -e POSTGRES_DB=librephotos \
  -e POSTGRES_USER=librephotos_user \
  -e POSTGRES_PASSWORD=your_secure_password \
  -v /home/yourusername/postgres_data:/var/lib/postgresql/data \
  postgres:17
```

### 2. LibrePhotos Container

```bash
sudo docker run -d \
  --name librephotos \
  --restart unless-stopped \
  -p 3000:8001 \
  -v /home/yourusername/librephotos/protected_media:/protected_media \
  -v /home/yourusername/librephotos/logs:/logs \
  -v /path/to/your/photos:/data \
  -e SERVE_FRONTEND=true \
  -e DB_BACKEND=postgresql \
  -e DB_NAME=librephotos \
  -e DB_USER=librephotos_user \
  -e DB_PASS=your_secure_password \
  -e DB_HOST=localhost \
  -e DB_PORT=5432 \
  reallibrephotos/librephotos-unified:latest
```

## Next Steps

Once LibrePhotos is running, you'll be guided through a **First Time Setup Wizard** that will help you:

1. Create your admin account
2. Configure site settings (uploads, user registration)
3. Set up your photo scan directory

For more details, see the [first steps guide](../user-guide/first-steps.md). 