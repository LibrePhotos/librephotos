FROM ubuntu:20.04
# system packages installation
ARG TARGETPLATFORM
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
		build-essential \
		bzip2 \
		cifs-utils \
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
		nfs-common \
		pkg-config \ 
		python3-dev \
		python3-pip \
		swig \
		unzip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN if [ "$TARGETPLATFORM" = "linux/amd64" ]; then pip3 install torch torchvision; 
RUN if [ "$TARGETPLATFORM" = "linux/arm64" ]; then pip3 install torch torchvision -f https://torch.kmtea.eu/whl/stable.html;

RUN pip3 install pyvips==2.1.15 cmake==3.21.2

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
ARG IMAGEMAGICK_VERSION=7.1.0-5
RUN curl -SL https://www.imagemagick.org/download/releases/ImageMagick-${IMAGEMAGICK_VERSION}.tar.gz | tar -zx && \
	cd ImageMagick-${IMAGEMAGICK_VERSION} && \
	./configure --with-modules && \
	make install && \
	ldconfig /usr/local/lib

# Build and install libvips
WORKDIR /tmp/builds
ARG VIPSVERSION=8.11.0
RUN curl -SL https://github.com/libvips/libvips/releases/download/v${VIPSVERSION}/vips-${VIPSVERSION}.tar.gz | tar -xz \ 
	&& cd vips-${VIPSVERSION} \ 
	&& ./configure \ 
	&& make V=0 \ 
	&& make install \ 
	&& ldconfig

# Build and install dlib
WORKDIR /tmp/builds
RUN git clone --depth 1 --branch 'v19.22' https://github.com/davisking/dlib.git && \
    mkdir dlib/build && \
    cd dlib/build && \
    cmake .. -DDLIB_USE_CUDA=0 -DUSE_AVX_INSTRUCTIONS=0 -DLIB_NO_GUI_SUPPORT=0 && \
    cmake --build . && \
    cd /tmp/builds/dlib && \
    python3 setup.py install --no USE_AVX_INSTRUCTIONS --no DLIB_USE_CUDA --no USE_SSE4_INSTRUCTIONS  

#Build and install faiss. Needs to be build for ARM 
WORKDIR /tmp/builds
RUN git clone --depth 1 --branch 'v1.7.1' https://github.com/facebookresearch/faiss.git && \
	cd faiss  && \
	cmake -B build . -DCMAKE_BUILD_TYPE=Release -DFAISS_ENABLE_GPU=OFF -DFAISS_ENABLE_PYTHON=ON -DFAISS_OPT_LEVEL=generic  && \
	make -C build -j4 faiss && \
	make -C build -j4 swigfaiss && \
	cd build/faiss/python && \
	python3 setup.py install && \
	unzip /usr/local/lib/python3.8/dist-packages/faiss*.egg -d /usr/local/lib/python3.8/dist-packages/

# pre trained models download
WORKDIR /data_models

RUN mkdir -p /root/.cache/torch/hub/checkpoints/ && \
	curl -SL https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/places365.tar.gz | tar -zxC /data_models/ && \
	curl -SL https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/im2txt.tar.gz | tar -zxC /data_models/ && \
	curl -SL https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/clip-embeddings.tar.gz | tar -zxC /data_models/ && \
	curl -SL https://download.pytorch.org/models/resnet152-b121ed2d.pth -o /root/.cache/torch/hub/checkpoints/resnet152-b121ed2d.pth

RUN rm -fr /tmp/*
