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

# Determine how to run privileged commands
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    else
        echo "WARNING: Not running as root and sudo is not available." >&2
        echo "         Skipping system package installation." >&2
        echo "         Please install these packages manually as root:" >&2
        echo "           build-essential cmake libboost-all-dev" >&2
        echo "           libimage-exiftool-perl libmagic1 libvips-dev" >&2
    fi
fi

if [ -n "$SUDO" ] || [ "$(id -u)" -eq 0 ]; then
    echo "==> Installing system dependencies..."
    $SUDO apt-get update -qq
    $SUDO apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        libboost-all-dev \
        libimage-exiftool-perl \
        libmagic1 \
        libvips-dev
fi

echo "==> Installing Python dependencies..."
# Install inside an active virtualenv if one is available; otherwise fall back
# to --user to avoid modifying the system Python installation.
if [ -n "${VIRTUAL_ENV:-}" ]; then
    pip install --no-cache-dir -r requirements.txt -r requirements.dev.txt
else
    echo "  (No virtualenv active — using --user install to avoid modifying system Python)"
    pip install --no-cache-dir --user -r requirements.txt -r requirements.dev.txt
fi

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
