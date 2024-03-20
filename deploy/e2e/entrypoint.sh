#!/usr/bin/env bash

MEDIA_DIR=${MEDIA_DIR:-/data}
PROTECTED_MEDIA_DIR=${PROTECTED_MEDIA_DIR:-/protected_media}

echo "Downloading assets for testing..."
mkdir -p $MEDIA_DIR
curl -Lso- https://libre.photos/link/librephotos-e2e-media | tar -xJC $MEDIA_DIR
curl -Lso- https://libre.photos/link/librephotos-e2e-protected-media | tar -xJC $PROTECTED_MEDIA_DIR

echo "Executing entrypoint.sh..."
/entrypoint.sh
