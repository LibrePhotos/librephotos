# Runtime only: everything LibrePhotos needs comes from pip (libvips, LibRaw,
# ExifTool, ffmpeg, libpq, ONNX Runtime, insightface as prebuilt wheels); perl runs
# the ExifTool wheel.
#
# GPU: the ONNX Runtime WebGPU plugin (requirements.txt) runs the ML models on
# Vulkan. libvulkan1 is the loader it needs; mesa-vulkan-drivers are the Intel
# and AMD drivers (the container also needs /dev/dri). NVIDIA's driver comes
# from the host through the NVIDIA container toolkit
# (NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics). Without a GPU the
# models run on the CPU, as before.
FROM ubuntu:noble
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3-pip perl libvulkan1 mesa-vulkan-drivers && \
    ln -s /usr/bin/python3 /usr/local/bin/python && \
    pip3 install --upgrade --break-system-packages --ignore-installed pip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
