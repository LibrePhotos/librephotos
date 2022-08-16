FROM ubuntu:hirsute
ARG TARGETPLATFORM
ENV DEBIAN_FRONTEND=noninteractive

# Install python
RUN apt-get update \
  && apt-get install -y python3-pip python3-dev \
  && cd /usr/local/bin \
  && ln -s /usr/bin/python3 python \
  && pip3 install --upgrade pip

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    zip \
    git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN pip3 install cmake==3.21.2

# Build and install dlib
WORKDIR /tmp/builds
RUN git clone --depth 1 --branch 'v19.24' https://github.com/davisking/dlib.git && \
    mkdir dlib/build && \
    cd dlib/build && \
    cmake .. -DDLIB_USE_CUDA=0 -DUSE_AVX_INSTRUCTIONS=0 -DLIB_NO_GUI_SUPPORT=0 && \
    cmake --build . && \
    zip -r dlib.zip dlib \
