# Stage 1: Build Stage
FROM nvidia/cuda:12.6.2-cudnn-devel-ubuntu24.04 AS builder
ARG TARGETPLATFORM
ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3-pip python3-dev software-properties-common \
    build-essential bzip2 brotli curl ffmpeg git libboost-all-dev \
    libcfitsio-dev libexif-dev libexpat-dev libexpat1-dev libgif-dev \
    libglib2.0-dev libgsf-1-dev libheif-dev libimage-exiftool-perl \
    libimagequant-dev libjpeg-dev liblapack-dev liblcms2-dev libmagic1 \
    libopenblas-dev libopenexr-dev liborc-dev libpng-dev libpq-dev \
    librsvg2-dev libsm6 libtiff5-dev libtool libtool-bin libwebp-dev \
    libxrender-dev libpoppler-glib-dev libtiff-dev libfftw3-dev \
    libcfitsio-dev libnifti-dev libopenslide-dev libmatio-dev \
    libmagickcore-dev libmagickwand-dev libjxl-dev pkg-config rustc cargo \
    libvips-dev swig && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install ExifTool
WORKDIR /tmp/exiftool
RUN curl -SL https://exiftool.org/Image-ExifTool-13.04.tar.gz | tar -xz && \
    cd Image-ExifTool-13.04 && \
    perl Makefile.PL && \
    make install && \
    rm -rf /tmp/exiftool

# Install Python libraries
RUN pip3 install --no-cache-dir --break-system-packages torch torchvision cmake

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
ARG IMAGEMAGICK_VERSION=7.1.1-41
RUN curl -SL https://imagemagick.org/archive/releases/ImageMagick-${IMAGEMAGICK_VERSION}.tar.xz | tar -xJf- && \
    cd ImageMagick-${IMAGEMAGICK_VERSION} && \
    ./configure --with-modules && \
    make install && \
    ldconfig /usr/local/lib && \
    rm -rf /tmp/builds/*

# Build and install dlib
WORKDIR /tmp/builds
RUN git clone --depth 1 --branch 'master' https://github.com/davisking/dlib.git && \
    mkdir dlib/build && \
    cd dlib/build && \
    cmake .. -DLIB_USE_CUDA=1 -DUSE_AVX_INSTRUCTIONS=0 -DLIB_NO_GUI_SUPPORT=0 && \
    cmake --build . && \
    cd /tmp/builds/dlib && \
    python3 setup.py install --no USE_AVX_INSTRUCTIONS --no USE_SSE4_INSTRUCTIONS && \
    rm -rf /tmp/builds/*

# Stage 2: Deployment Stage
FROM ubuntu:24.04
ARG TARGETPLATFORM
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3-pip python3-dev libboost-all-dev libcfitsio8 libexif12 \
    libexpat1 libgif7 libglib2.0-0 libgsf-1-114 libheif1 libimagequant0 \
    libjpeg-turbo8 liblapack3 liblcms2-2 libmagic1 libopenblas0 \
    libopenexr25 liborc-0.4-0 libpng16-16 libpq5 librsvg2-2 libsm6 \
    libtiff5 libwebp6 libxrender1 libpoppler-glib8 libfftw3-3 libcfitsio8 \
    libnifti2 libopenslide0 libmatio9 libmagickcore-6.q16-6-extra \
    libmagickwand-6.q16-6 libjxl0.7 libvips42 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy necessary binaries and libraries from the build stage
COPY --from=builder /usr/local/lib /usr/local/lib
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /usr/local/include /usr/local/include

# Copy Python packages
COPY --from=builder /usr/local/lib/python3.10/dist-packages /usr/local/lib/python3.10/dist-packages

# Update dynamic linker cache
RUN ldconfig /usr/local/lib
