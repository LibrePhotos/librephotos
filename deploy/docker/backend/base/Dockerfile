# Stage 1: Build Stage
FROM ubuntu:resolute AS builder
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
  		libltdl-dev \
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
		libmagic1 \
		libopenblas-dev \
		libopenexr-dev \ 
		liborc-dev \
		libpng-dev \
		libpq-dev \
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
		libmagickcore-dev \
		libmagickwand-dev \
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

# Build and install LibRaw
WORKDIR /tmp/builds
RUN git clone https://github.com/LibRaw/LibRaw && \
    cd LibRaw && \
    autoreconf --install && \
    ./configure && \
    make && \
    make install && \
    rm -rf /tmp/builds/*

# Build and install ImageMagick
WORKDIR /tmp/builds
ARG IMAGEMAGICK_VERSION=7.1.1-40
# Fetched from the GitHub tag rather than imagemagick.org/archive/releases:
# that directory only keeps the latest few releases, so a pinned version
# vanishes from it within months (7.1.1-40 did in 2026, breaking this build
# with a 404 that arrived as an HTML page tar could not read). Git tags are
# permanent, the tag archive carries the generated configure script, and
# curl -f turns any future 404 into a loud failure instead of a puzzling one.
RUN curl -fsSL https://github.com/ImageMagick/ImageMagick/archive/refs/tags/${IMAGEMAGICK_VERSION}.tar.gz | tar -xzf- && \
	cd ImageMagick-${IMAGEMAGICK_VERSION} && \
	./configure --with-modules && \
	make install && \
	ldconfig /usr/local/lib && \
    rm -rf /tmp/builds/*

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
