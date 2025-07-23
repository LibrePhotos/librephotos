#!/bin/bash

set -e

echo "LibrePhotos starting..."

# Check if we should serve frontend
if [ "$SERVE_FRONTEND" = "True" ]; then
    echo "Configuring for no-proxy deployment (serving frontend from Django)..."
    
    # Copy the no-proxy settings and URLs
    cp /code/production_noproxy.py /code/librephotos/settings/production.py
    cp /code/urls_noproxy.py /code/librephotos/urls.py
    
    # Collect static files including frontend
    echo "Collecting static files..."
    python manage.py collectstatic --noinput
    
    echo "Frontend will be served from Django on port 8001"
else
    echo "Using standard proxy setup..."
fi

# Run migrations based on database backend
echo "Running migrations..."
DB_BACKEND=${DB_BACKEND:-sqlite}

if [ "$DB_BACKEND" = "sqlite" ]; then
    echo "Using production-optimized SQLite database mode"
    # Ensure database directory exists
    mkdir -p /data/db
    
    # Run migrations for both default and cache databases
    python manage.py migrate
    
elif [ "$DB_BACKEND" = "postgresql" ]; then
    echo "Using PostgreSQL database mode"
    
    # Run standard migrations
    python manage.py migrate
else
    echo "Error: Unsupported DB_BACKEND: $DB_BACKEND"
    echo "Supported values: sqlite, postgresql"
    exit 1
fi

# Create cache directory
mkdir -p /root/.cache

# Check if we need to create a superuser
if [ ! -z "$ADMIN_USERNAME" ] && [ ! -z "$ADMIN_PASSWORD" ]; then
    echo "Creating/updating admin user..."
    python manage.py shell <<EOF
from api.models import User
from django.contrib.auth.hashers import make_password
import os

username = os.environ.get('ADMIN_USERNAME')
password = os.environ.get('ADMIN_PASSWORD')
email = os.environ.get('ADMIN_EMAIL', 'admin@example.com')

try:
    user = User.objects.get(username=username)
    user.set_password(password)
    user.email = email
    user.save()
    print(f"Updated existing admin user: {username}")
except User.DoesNotExist:
    user = User.objects.create_superuser(username=username, password=password, email=email)
    print(f"Created new admin user: {username}")
EOF
fi

echo "Starting Django server..."

python manage.py start_service all
python manage.py start_cleaning_service
python manage.py clear_cache 
python manage.py build_similarity_index 2>&1 | tee /logs/command_build_similarity_index.log
python manage.py qcluster 2>&1 | tee /logs/qcluster.log &

# Start the Django server
if [ "$DEBUG" = "1" ]; then
    python manage.py runserver 0.0.0.0:8001
else
    # Production server with gunicorn
    gunicorn --bind 0.0.0.0:8001 --workers ${WEB_CONCURRENCY:-4} --timeout 3600 --max-requests 2000 --max-requests-jitter 50 librephotos.wsgi:application
fi 