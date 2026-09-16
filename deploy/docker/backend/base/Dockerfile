# Everything LibrePhotos needs at runtime that pip cannot provide: Python, a
# compiler for the one sdist without Linux wheels (insightface), ffmpeg for
# video, and perl for the ExifTool wheel. libvips, LibRaw, ExifTool and libpq
# all arrive as wheels with apps/backend/requirements.txt.
FROM ubuntu:noble
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3-pip \
        python3-dev \
        build-essential \
        ffmpeg \
        perl \
        curl \
        libgomp1 \
        libgl1 \
        libglib2.0-0 && \
    ln -s /usr/bin/python3 /usr/local/bin/python && \
    pip3 install --upgrade --break-system-packages --ignore-installed pip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
