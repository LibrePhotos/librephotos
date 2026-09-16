# Runtime only: every library LibrePhotos needs comes from pip (libvips, LibRaw,
# ExifTool, libpq, ONNX Runtime, insightface as prebuilt wheels). ffmpeg for video,
# perl for the ExifTool wheel.
FROM ubuntu:noble
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3-pip ffmpeg perl && \
    ln -s /usr/bin/python3 /usr/local/bin/python && \
    pip3 install --upgrade --break-system-packages --ignore-installed pip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
