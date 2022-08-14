FROM reallibrephotos/librephotos-base:dev

# Build and install dlib
WORKDIR /tmp/builds
RUN git clone --depth 1 --branch 'v19.24' https://github.com/davisking/dlib.git && \
    mkdir dlib/build && \
    cd dlib/build && \
    cmake .. -DDLIB_USE_CUDA=0 -DUSE_AVX_INSTRUCTIONS=0 -DLIB_NO_GUI_SUPPORT=0 && \
    cmake --build . && \
    cd /tmp/builds/dlib && \
    python3 setup.py install --no USE_AVX_INSTRUCTIONS --no DLIB_USE_CUDA --no USE_SSE4_INSTRUCTIONS  

# Build and install faiss. Needs to be build for ARM 
WORKDIR /tmp/builds
RUN git clone --depth 1 --branch 'v1.7.1' https://github.com/facebookresearch/faiss.git && \
	cd faiss  && \
	cmake -B build . -DCMAKE_BUILD_TYPE=Release -DFAISS_ENABLE_GPU=OFF -DFAISS_ENABLE_PYTHON=ON -DFAISS_OPT_LEVEL=generic  && \
	make -C build -j4 faiss && \
	make -C build -j4 swigfaiss && \
	cd build/faiss/python && \
	python3 setup.py install && \
	unzip /usr/local/lib/python3.9/dist-packages/faiss*.egg -d /usr/local/lib/python3.9/dist-packages/

# Download pretrained models 
WORKDIR /data_models
RUN mkdir -p /root/.cache/torch/hub/checkpoints/ && \
	curl -SL https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/places365.tar.gz | tar -zxC /data_models/ && \
	curl -SL https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/im2txt.tar.gz | tar -zxC /data_models/ && \
	curl -SL https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/clip-embeddings.tar.gz | tar -zxC /data_models/ && \
	curl -SL https://download.pytorch.org/models/resnet152-b121ed2d.pth -o /root/.cache/torch/hub/checkpoints/resnet152-b121ed2d.pth

RUN rm -fr /tmp/*
