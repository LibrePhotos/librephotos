# CUDA runtime plus what pip cannot provide (see deploy/docker/backend/base/Dockerfile).
# Ubuntu 22.04 means Python 3.10; requirements.txt keeps py3.10-compatible pins for it.
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3-pip perl && \
    ln -s /usr/bin/python3 /usr/local/bin/python && \
    pip3 install --upgrade --ignore-installed pip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# No PyTorch: every ML model LibrePhotos runs is served by ONNX Runtime. The
# application image swaps in onnxruntime-gpu (see deploy/docker/backend-gpu/Dockerfile).
