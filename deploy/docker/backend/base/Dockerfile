# Stage 1: Build Stage
FROM ubuntu:noble AS builder
ARG TARGETPLATFORM
ENV DEBIAN_FRONTEND=noninteractive

# Install python
RUN apt-get update \
  && apt-get install -y python3-pip python3-dev \
  && cd /usr/local/bin \
  && ln -s /usr/bin/python3 python \
  && pip3 install --upgrade --break-system-packages --ignore-installed pip \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# System packages installation
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
		build-essential \
		bzip2 \
		brotli \
		curl \
		ffmpeg \
		git \
		libcfitsio-dev \ 
		libexif-dev \
		libexpat-dev \
		libexpat1-dev \ 
		libgif-dev \
		libglib2.0-dev \
		libgsf-1-dev \ 
		libheif-dev \
		libimage-exiftool-perl \
		libimagequant-dev \
		libjpeg-dev \
		libgomp1 \
		liblapack-dev \
		liblcms2-dev \
		libopenblas-dev \
		libopenexr-dev \ 
		liborc-dev \
		libpng-dev \
		librsvg2-dev \
		libsm6 \
		libtiff5-dev \ 
		libtool \ 
		libtool-bin \
		libwebp-dev \
		libxrender-dev \
  		libpoppler-glib-dev \
		libtiff-dev \
		libfftw3-dev \
		libpng-dev \
		libcfitsio-dev \
		libnifti-dev \
		libopenslide-dev \
		libopenexr-dev \
		libmatio-dev \
		libjxl-dev \
		pkg-config \ 
		libjxl-dev \
		libvips-dev \
  		libc6-dev \
    		cmake \
		libbz2-dev \
        	libzip-dev && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install ExifTool
WORKDIR /tmp/exiftool
ARG EXIFTOOL_VERSION=13.57
# exiftool.org hosts only the current release, so a pinned version disappears
# from it as soon as the next one ships (13.57 already has). The GitHub tag
# archive is permanent; it unpacks as exiftool-<version> rather than
# Image-ExifTool-<version>.
RUN curl -fsSL https://github.com/exiftool/exiftool/archive/refs/tags/${EXIFTOOL_VERSION}.tar.gz | tar -xz && \
    cd exiftool-${EXIFTOOL_VERSION} && \
    perl Makefile.PL && \
    make install && \
    rm -rf /tmp/exiftool

# No PyTorch: every ML model LibrePhotos runs is served by ONNX Runtime, which
# arrives with apps/backend/requirements.txt in the application image.
