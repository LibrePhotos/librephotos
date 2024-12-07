# Stage 1: Build Stage
FROM nvidia/cuda:12.6.2-cudnn-devel-ubuntu24.04 AS builder
ARG TARGETPLATFORM
ENV DEBIAN_FRONTEND=noninteractive

# Install python
RUN apt-get update \
	&& apt-get install -y python3-pip python3-dev software-properties-common \
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
 	cmake \
	libboost-all-dev \
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
	libjxl-dev \
	pkg-config \ 
	libvips-dev \
	swig && \
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

# Install python
RUN apt-get update \
	&& apt-get install -y python3-pip python3-dev\
	&& cd /usr/local/bin \
	&& ln -s /usr/bin/python3 python \
	&& pip3 install --upgrade --break-system-packages --ignore-installed pip \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/*

# Install minimal required libraries
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    brotli \
    curl \
    ffmpeg \
    git \
    libvips-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff5-dev \
    libwebp-dev \
    libraw-dev \
    libboost-all-dev \
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install ExifTool
WORKDIR /tmp/exiftool
RUN curl -SL https://exiftool.org/Image-ExifTool-13.04.tar.gz | tar -xz && \
    cd Image-ExifTool-13.04 && \
    perl Makefile.PL && \
    make install && \
    rm -rf /tmp/exiftool

RUN pip3 install --no-cache-dir --break-system-packages torch torchvision --extra-index-url https://download.pytorch.org/whl/cpu

# Copy only required components from the builder stage
COPY --from=builder /usr/local/lib/libMagick* /usr/local/lib/
COPY --from=builder /usr/local/lib/libraw* /usr/local/lib/
COPY --from=builder /usr/local/lib/libdlib* /usr/local/lib/
COPY --from=builder /usr/local/bin/magick /usr/local/bin/

# Update dynamic linker cache
RUN ldconfig /usr/local/lib
