#!/bin/bash
# Setup script for running Django tests outside of the Docker container.
# Run this once before running tests for the first time on a new machine.
#
# Usage:
#   bash scripts/setup_test_env.sh
#
# After running this script, run tests with:
#   DJANGO_SETTINGS_MODULE=librephotos.settings.test_sqlite python manage.py test api.tests

set -e

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    SUDO="sudo"
fi

echo "==> Installing system dependencies..."
$SUDO apt-get update -qq
$SUDO apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    libboost-all-dev \
    libimage-exiftool-perl \
    libmagic1 \
    libvips-dev

echo "==> Installing Python dependencies..."
pip install --no-cache-dir -r requirements.txt -r requirements.dev.txt

echo "==> Creating test runtime directories..."
mkdir -p /tmp/librephotos/logs /tmp/librephotos/protected_media /tmp/librephotos/data

echo ""
echo "Setup complete!"
echo ""
echo "Run tests with:"
echo "  BASE_LOGS=/tmp/librephotos/logs BASE_DATA=/tmp/librephotos SECRET_KEY=test-secret-key DJANGO_SETTINGS_MODULE=librephotos.settings.test_sqlite python manage.py test api.tests"
echo ""
echo "Run a single test module:"
echo "  BASE_LOGS=/tmp/librephotos/logs BASE_DATA=/tmp/librephotos SECRET_KEY=test-secret-key DJANGO_SETTINGS_MODULE=librephotos.settings.test_sqlite python manage.py test api.tests.test_photo_metadata"
