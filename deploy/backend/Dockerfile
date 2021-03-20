FROM python:3.8

# system packages installation

RUN apt update && apt install -y curl nfs-common cifs-utils libopenblas-dev libmagickwand-dev libheif-dev libmagic1 ufraw-batch libboost-all-dev libxrender-dev liblapack-dev git bzip2 cmake build-essential libsm6 libglib2.0-0 libgl1-mesa-glx --no-install-recommends

# pre trained models download
WORKDIR /data_models
RUN mkdir -p /data_models/places365/
RUN mkdir -p /data_models/im2txt/
RUN mkdir -p /root/.cache/torch/hub/checkpoints/
RUN curl -SL https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/places365_model.tar.gz | tar -zxC /data_models/places365/
RUN curl -SL https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/im2txt_model.tar.gz | tar -zxC /data_models/im2txt/
RUN curl -SL https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/im2txt_data.tar.gz | tar -zxC /data_models/im2txt/
RUN curl -SL https://download.pytorch.org/models/resnet152-b121ed2d.pth -o /root/.cache/torch/hub/checkpoints/resnet152-b121ed2d.pth
RUN pip install torch==1.7.1+cpu torchvision==0.8.2+cpu -f https://download.pytorch.org/whl/torch_stable.html
RUN pip install -v --install-option="--no" --install-option="DLIB_USE_CUDA" --install-option="--no" --install-option="USE_AVX_INSTRUCTIONS" --install-option="--no" --install-option="USE_SSE4_INSTRUCTIONS" dlib
# actual project
ARG DEBUG
WORKDIR /code
RUN git clone https://github.com/LibrePhotos/librephotos .
RUN pip install -r requirements.txt
RUN if [ "$DEBUG" = 1 ] ; then pip install -r requirements.dev.txt ;  fi
RUN python -m spacy download en_core_web_sm
EXPOSE 8001

COPY entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"]
