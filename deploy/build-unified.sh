#!/bin/bash

# Build script for LibrePhotos Unified (No-Proxy) Image

set -e

echo "Building LibrePhotos Unified Image (No-Proxy)..."
echo "This will create a single container with both frontend and backend."

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    echo "Error: Please run this script from the librephotos-docker directory"
    exit 1
fi

# Get version tag (default to 'dev')
TAG=${1:-dev}
IMAGE_NAME="reallibrephotos/librephotos-unified:${TAG}"

echo "Building image: ${IMAGE_NAME}"

# Build the unified image
docker build \
    --file unified/Dockerfile \
    --tag "${IMAGE_NAME}" \
    --build-arg IMAGE_TAG="${TAG}" \
    unified/

echo ""
echo "✅ Build complete!"
echo "Image: ${IMAGE_NAME}"
echo ""
echo "To use this image:"
echo "1. Update your docker-compose.no-proxy.yml to use image: ${IMAGE_NAME}"
echo "2. Set SERVE_FRONTEND=true in your environment"
echo "3. Run: docker-compose -f docker-compose.no-proxy.yml up -d"
echo ""
echo "For more information, see README-no-proxy.md" 