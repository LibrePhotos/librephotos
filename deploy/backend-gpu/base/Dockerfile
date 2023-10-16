FROM nvidia/cuda:11.7.1-cudnn8-devel-ubuntu22.04
ARG TARGETPLATFORM
ENV DEBIAN_FRONTEND=noninteractive

# Install python
RUN apt-get update \
	&& apt-get install -y python3-pip python3-dev \
	&& cd /usr/local/bin \
	&& ln -s /usr/bin/python3 python \
	&& pip3 install --upgrade pip \
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
	libboost-all-dev \
	libcfitsio-dev \ 
	libexif-dev \
	libexpat-dev \
	libexpat1-dev \ 
	libgif-dev \
	libgl1-mesa-glx \
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
	pkg-config \ 
	rustc \
	cargo \
	libtinfo5 \
	libvips-dev \
	swig && \
	apt-get clean && \
	rm -rf /var/lib/apt/lists/*

# Install ExifTool
WORKDIR /tmp/exiftool
RUN curl -SL https://exiftool.org/Image-ExifTool-12.64.tar.gz | tar -xz && \
	cd Image-ExifTool-12.64 && \
	perl Makefile.PL && \
	make install && \
	rm -rf /tmp/exiftool

# Current Version: pytorch 2.1 with cuda support
RUN pip3 install --no-cache-dir torch torchvision

# Install latest cmake version
RUN pip3 install --no-cache-dir cmake

#Build and install libraw, supports more RAW image types
WORKDIR /tmp/builds
RUN git clone https://github.com/LibRaw/LibRaw && \
	cd LibRaw && \ 
	autoreconf --install && \
	./configure && \
	make && \
	make install && \
	rm -rf /tmp/builds/*

#Build and install imagemagick to use current libraw
WORKDIR /tmp/builds
ARG IMAGEMAGICK_VERSION=7.1.1-8
RUN curl -SL https://imagemagick.org/archive/releases/ImageMagick-${IMAGEMAGICK_VERSION}.tar.xz | tar -xJf- && \
	cd ImageMagick-${IMAGEMAGICK_VERSION} && \
	./configure --with-modules && \
	make install && \
	ldconfig /usr/local/lib && \
	rm -rf /tmp/builds/*

# Build and install dlib
# Compile it WITHOUT AVX and SSE4 instructions to ensure compatibility
WORKDIR /tmp/builds
RUN git clone --depth 1 --branch 'master' https://github.com/davisking/dlib.git && \
	mkdir dlib/build && \
	cd dlib/build && \
	cmake .. -DLIB_USE_CUDA=1 -DUSE_AVX_INSTRUCTIONS=0 -DLIB_NO_GUI_SUPPORT=0 && \
	cmake --build . && \
	cd /tmp/builds/dlib && \
	python3 setup.py install --no USE_AVX_INSTRUCTIONS --no USE_SSE4_INSTRUCTIONS && \
	rm -rf /tmp/builds/* 

# Download pretrained models
WORKDIR /data_models
RUN mkdir -p /root/.cache/torch/hub/checkpoints/ && \
	curl -SL https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/places365.tar.gz | tar -zxC /data_models/ && \
	curl -SL https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/im2txt.tar.gz | tar -zxC /data_models/ && \
	curl -SL https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/clip-embeddings.tar.gz | tar -zxC /data_models/ && \
	curl -SL https://download.pytorch.org/models/resnet152-b121ed2d.pth -o /root/.cache/torch/hub/checkpoints/resnet152-b121ed2d.pth

