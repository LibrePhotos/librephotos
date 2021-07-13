FROM ubuntu:groovy
# system packages installation

RUN apt update && apt install -y ffmpeg libimage-exiftool-perl curl nfs-common cifs-utils libopenblas-dev libheif-dev libmagic1 libraw-dev libboost-all-dev libxrender-dev liblapack-dev git bzip2 cmake build-essential libsm6 libglib2.0-dev libgl1-mesa-glx libpq-dev libexpat-dev \
	librsvg2-dev \
	libpng-dev \
	libgif-dev \
	libjpeg-dev \
	libexif-dev \
	liblcms2-dev \
	liborc-dev \
	pkg-config \ 
	libexpat1-dev \ 
	libtiff5-dev \ 
	libgsf-1-dev \ 
	libopenexr-dev \ 
	libcfitsio-dev \ 
	libimagequant-dev \
	libtool \ 
	libtool-bin \
	wget \
	libwebp-dev --no-install-recommends
#Build and install python
RUN apt-get update \
  && apt-get install -y python3-pip python3-dev \
  && cd /usr/local/bin \
  && ln -s /usr/bin/python3 python \
  && pip3 install --upgrade pip

#Build and install libraw
#RUN mkdir /libraw
#RUN curl -SL https://www.libraw.org/data/LibRaw-0.20.2.tar.gz | tar -zxC /libraw
RUN git clone https://github.com/LibRaw/LibRaw
RUN ls
WORKDIR /LibRaw
RUN autoreconf --install
RUN ./configure
RUN make
RUN make install

#Build and install imagemagick
WORKDIR /
RUN mkdir /imagemagick
RUN curl -SL https://www.imagemagick.org/download/ImageMagick.tar.gz | tar -zxC /imagemagick
WORKDIR /imagemagick/ImageMagick-7.1.0-2
RUN ./configure --with-modules
RUN make install
RUN ldconfig /usr/local/lib

# Build and install libvips
ARG VIPSVERSION=8.11.0
ARG VIPSURL=https://github.com/libvips/libvips/releases/download
WORKDIR /usr/local/src
RUN wget ${VIPSURL}/v${VIPSVERSION}/vips-${VIPSVERSION}.tar.gz \ 
	&& tar xzf vips-${VIPSVERSION}.tar.gz \ 
	&& cd vips-${VIPSVERSION} \ 
	&& ./configure \ 
	&& make V=0 \ 
	&& make install \ 
	&& ldconfig

# pre trained models download
WORKDIR /data_models
RUN mkdir -p /root/.cache/torch/hub/checkpoints/
RUN curl -SL -k https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/places365.tar.gz | tar -zxC /data_models/
RUN curl -SL -k https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/im2txt.tar.gz | tar -zxC /data_models/
RUN curl -SL -k https://download.pytorch.org/models/resnet152-b121ed2d.pth -o /root/.cache/torch/hub/checkpoints/resnet152-b121ed2d.pth
RUN pip install torch==1.8.0+cpu torchvision==0.9.0+cpu -f https://download.pytorch.org/whl/torch_stable.html

RUN pip3 install pyvips

# Build and install dlib
WORKDIR /
RUN git clone https://github.com/davisking/dlib.git && \
    mkdir /dlib/build && \
    cd /dlib/build && \
    cmake .. -DDLIB_USE_CUDA=0 -DUSE_AVX_INSTRUCTIONS=0 -DLIB_NO_GUI_SUPPORT=0 && \
    cmake --build . && \
    cd /dlib && \
    python setup.py install --no USE_AVX_INSTRUCTIONS --no DLIB_USE_CUDA --no USE_SSE4_INSTRUCTIONS  

# actual project
ARG DEBUG
WORKDIR /code
COPY . .
RUN pip install -r requirements.txt
RUN if [ "$DEBUG" = 1 ] ; then pip install -r requirements.dev.txt ;  fi
RUN python -m spacy download en_core_web_sm
EXPOSE 8001

COPY entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"]
