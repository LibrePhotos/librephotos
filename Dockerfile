FROM ubuntu:16.04
MAINTAINER ViViDboarder <vividboarder@gmail.com>

ENV MAPZEN_API_KEY mapzen-XXXX
ENV MAPBOX_API_KEY mapbox-XXXX
ENV ALLOWED_HOSTS=*

RUN apt-get update && \
    apt-get install -y \
    libsm6 \
    libboost-all-dev \
    libglib2.0-0 \
    libxrender-dev \
    python3-tk \
    python3 \
    python3-pip \
    wget \
    curl \
    nginx

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
    cmake .. -DDLIB_USE_CUDA=0 -DUSE_AVX_INSTRUCTIONS=0 && \
    cmake --build . && \
    cd /dlib && \
    /venv/bin/python setup.py install --no USE_AVX_INSTRUCTIONS --no DLIB_USE_CUDA

RUN /venv/bin/pip install cython

RUN mkdir /code
WORKDIR /code
COPY requirements.txt /code/

RUN /venv/bin/pip install http://download.pytorch.org/whl/cpu/torch-0.4.0-cp35-cp35m-linux_x86_64.whl && /venv/bin/pip install torchvision

RUN /venv/bin/pip install -r requirements.txt

RUN /venv/bin/python -m spacy download en_core_web_sm

WORKDIR /code/api/places365
RUN wget https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/places365_model.tar.gz
RUN tar xf places365_model.tar.gz

WORKDIR /code/api/im2txt
RUN wget https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/im2txt_model.tar.gz
RUN tar xf im2txt_model.tar.gz
RUN wget https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/im2txt_data.tar.gz
RUN tar xf im2txt_data.tar.gz


WORKDIR /
RUN curl -sL https://deb.nodesource.com/setup_8.x -o nodesource_setup.sh
RUN bash nodesource_setup.sh
RUN apt-get install nodejs

RUN rm -rf /var/lib/apt/lists/*

WORKDIR /code
RUN git clone https://github.com/hooram/ownphotos-frontend.git
WORKDIR /code/ownphotos-frontend
RUN mv /code/ownphotos-frontend/src/api_client/apiClientDeploy.js /code/ownphotos-frontend/src/api_client/apiClient.js
RUN npm install
RUN npm install -g serve

RUN apt-get remove --purge -y cmake git && \
    rm -rf /var/lib/apt/lists/*

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

ENV BACKEND_HOST localhost
ENV BACKEND_PROTOCOL http


# REDIS location
ENV REDIS_HOST redis
ENV REDIS_PORT 11211

# Timezone
ENV TIME_ZONE UTC

EXPOSE 80
EXPOSE 3000
EXPOSE 5000

COPY . /code

RUN mkdir /code/logs

RUN mv /code/config_docker.py /code/config.py

WORKDIR /code

ENTRYPOINT ./entrypoint.sh
