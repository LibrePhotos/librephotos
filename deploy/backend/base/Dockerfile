FROM ubuntu:jammy
ARG TARGETPLATFORM
ENV DEBIAN_FRONTEND=noninteractive

# Install python
RUN apt-get update \
  && apt-get install -y python3-pip python3-dev \
  && cd /usr/local/bin \
  && ln -s /usr/bin/python3 python \
  && pip3 install --upgrade pip

# system packages installation
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
		build-essential \
		bzip2 \
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
		libraw-dev \
		librsvg2-dev \
		libsm6 \
		libtiff5-dev \ 
		libtool \ 
		libtool-bin \
		libwebp-dev \
		libxrender-dev \
		pkg-config \ 
		rustc \ 
		libtinfo5 \
		swig \
		unzip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
    
RUN if [ "$TARGETPLATFORM" = "linux/arm64" ]; then pip3 install --no-cache-dir torch torchvision -f https://torch.kmtea.eu/whl/stable.html; else pip3 install --no-cache-dir torch torchvision; fi

RUN pip3 install --no-cache-dir cmake==3.21.2

#Build and install libraw
WORKDIR /tmp/builds
RUN git clone https://github.com/LibRaw/LibRaw && \
	cd LibRaw && \ 
	autoreconf --install && \
	./configure && \
	make && \
	make install

#Build and install imagemagick
WORKDIR /tmp/builds
ARG IMAGEMAGICK_VERSION=7.1.0-29
RUN curl -SL https://imagemagick.org/archive/releases/ImageMagick-${IMAGEMAGICK_VERSION}.tar.xz | tar -xf && \
	cd ImageMagick-${IMAGEMAGICK_VERSION} && \
	./configure --with-modules && \
	make install && \
	ldconfig /usr/local/lib

# Build and install libvips
WORKDIR /tmp/builds
ARG VIPSVERSION=8.13.0
RUN curl -SL https://github.com/libvips/libvips/releases/download/v${VIPSVERSION}/vips-${VIPSVERSION}.tar.gz | tar -xz \ 
	&& cd vips-${VIPSVERSION} \ 
	&& ./configure \ 
	&& make V=0 \ 
	&& make install \ 
	&& ldconfig
