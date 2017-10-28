FROM ubuntu:16.04
MAINTAINER ViViDboarder <vividboarder@gmail.com>

ENV MAPZEN_API_KEY mapzen-XXXX
ENV ALLOWED_HOSTS=*

RUN apt-get update && \
    apt-get install -y \
    libboost-all-dev \
    python3 \
    python3-pip \
    && \
    rm -rf /var/lib/apt/lists/*

# RUN apt-get install libopenblas-dev liblapack-dev

RUN pip3 install virtualenv

# Create venv
RUN virtualenv /venv

# Build and install dlib
RUN apt-get update && \
    apt-get install -y cmake git && \
    git clone https://github.com/davisking/dlib.git && \
    mkdir /dlib/build && \
    cd /dlib/build && \
    cmake .. -DDLIB_USE_CUDA=0 -DUSE_AVX_INSTRUCTIONS=1 && \
    cmake --build . && \
    cd /dlib && \
    /venv/bin/python setup.py install --yes USE_AVX_INSTRUCTIONS --no DLIB_USE_CUDA && \
    apt-get remove --purge -y cmake git && \
    rm -rf /var/lib/apt/lists/*

# Install dlib
# RUN git clone https://github.com/davisking/dlib.git
# RUN mkdir /dlib/build
# WORKDIR /dlib/build
#
# RUN cmake .. -DDLIB_USE_CUDA=0 -DUSE_AVX_INSTRUCTIONS=1
# RUN cmake --build .
#
# WORKDIR /dlib
#
# RUN /venv/bin/python setup.py install --yes USE_AVX_INSTRUCTIONS --no DLIB_USE_CUDA

RUN mkdir /code
WORKDIR /code
COPY requirements.txt /code/

RUN /venv/bin/pip install -r requirements.txt

VOLUME /data

# Application admin creds
ENV ADMIN_EMAIL admin@dot.com
ENV ADMIN_USERNAME admin
ENV ADMIN_PASSWORD changeme

# Django key. CHANGEME
ENV SECRET_KEY supersecretkey
# Until we serve media files properly (django dev server doesn't serve media files with with debug=false)
ENV DEBUG true 

# Database connection info
ENV DB_BACKEND postgresql
ENV DB_NAME ownphotos
ENV DB_USER ownphotos
ENV DB_PASS ownphotos
ENV DB_HOST database
ENV DB_PORT 5432

# Memcache location
ENV CACHE_HOST_PORT memcached:11211

# Timezone
ENV TIME_ZONE UTC

EXPOSE 8000

COPY . /code

ENTRYPOINT ./entrypoint.sh
