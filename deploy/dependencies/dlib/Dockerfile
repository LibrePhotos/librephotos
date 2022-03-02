FROM ubuntu:hirsute
ARG TARGETPLATFORM
ENV DEBIAN_FRONTEND=noninteractive

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
RUN git clone --depth 1 --branch 'v19.22' https://github.com/davisking/dlib.git && \
    mkdir dlib/build && \
    cd dlib/build && \
    cmake .. -DDLIB_USE_CUDA=0 -DUSE_AVX_INSTRUCTIONS=0 -DLIB_NO_GUI_SUPPORT=0 && \
    cmake --build . && \
    zip -r dlib.zip dlib \