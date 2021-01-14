# syntax = docker/dockerfile:experimental

# docker pull docker/dockerfile:experimental
# build Dockerfile: DOCKER_BUILDKIT=1 docker build -t librephotos:dev ./
# build docker-compose: COMPOSE_DOCKER_CLI_BUILD=1 DOCKER_BUILDKIT=1 docker-compose build

FROM ubuntu:20.10 AS base
LABEL maintainer="a"

RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update
RUN apt-get install -y curl nginx libopenblas-dev libmagic1 libboost-all-dev libxrender-dev liblapack-dev
RUN rm -rf /var/lib/apt/lists/*


#install miniconda
FROM base AS conda
RUN curl -SL https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh > Miniconda3-latest-Linux-x86_64.sh
RUN bash Miniconda3-latest-Linux-x86_64.sh -b -p /miniconda
RUN rm Miniconda3-latest-Linux-x86_64.sh
RUN /miniconda/bin/conda install -y -c pytorch pytorch torchvision torchaudio cpuonly numpy pandas scikit-learn scikit-image faiss-cpu
RUN /miniconda/bin/conda install -y psycopg2 cython
RUN /miniconda/bin/conda clean -t


# Build and install dlib
FROM conda as dlib
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update
#libopenblas-dev libmagic1 libxrender-dev liblapack-dev
RUN apt-get install -y git bzip2 cmake build-essential libsm6 libglib2.0-0 libgl1-mesa-glx --no-install-recommends
RUN git clone -c http.sslverify=false https://github.com/davisking/dlib.git
WORKDIR /dlib/build
RUN cmake .. -DDLIB_USE_CUDA=0 -DUSE_AVX_INSTRUCTIONS=0 -DLIB_NO_GUI_SUPPORT=0
RUN cmake --build .
WORKDIR /dlib
RUN /miniconda/bin/python setup.py install --no USE_AVX_INSTRUCTIONS --no USE_SSE4_INSTRUCTIONS
RUN rm -rf /var/lib/apt/lists/*


#install required pip packages
FROM base AS required
WORKDIR /code
RUN mkdir -p /code/api/places365/
RUN mkdir -p /code/api/im2txt/
RUN mkdir -p /root/.cache/torch/hub/checkpoints/
RUN curl -SL https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/places365_model.tar.gz | tar -zxC /code/api/places365/
RUN curl -SL https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/im2txt_model.tar.gz | tar -zxC /code/api/im2txt/
RUN curl -SL https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/im2txt_data.tar.gz | tar -zxC /code/api/im2txt/
RUN curl -SL https://download.pytorch.org/models/resnet152-b121ed2d.pth -o /root/.cache/torch/hub/checkpoints/resnet152-b121ed2d.pth
#libopenblas-dev libboost-all-dev libxrender-dev liblapack-dev
COPY --from=dlib /miniconda/ /miniconda/
COPY requirements.txt /code/
RUN /miniconda/bin/pip install -r requirements.txt
RUN /miniconda/bin/python -m spacy download en_core_web_sm


#create final release
FROM required AS dev
#libopenblas-dev libmagic1
COPY . /code
RUN mv /code/config_docker.py /code/config.py
EXPOSE 80
WORKDIR /code
ENTRYPOINT ./entrypoint.sh

