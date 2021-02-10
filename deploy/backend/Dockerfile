FROM python:3.8

# system packages installation
RUN apt update && apt install -y curl libopenblas-dev libmagic1 libboost-all-dev libxrender-dev liblapack-dev git bzip2 cmake build-essential libsm6 libglib2.0-0 libgl1-mesa-glx --no-install-recommends

# pre trained models download
WORKDIR /data_models
RUN mkdir -p /data_models/places365/
RUN mkdir -p /data_models/im2txt/
RUN mkdir -p /root/.cache/torch/hub/checkpoints/
RUN curl -SL https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/places365_model.tar.gz | tar -zxC /data_models/places365/
RUN curl -SL https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/im2txt_model.tar.gz | tar -zxC /data_models/im2txt/
RUN curl -SL https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/im2txt_data.tar.gz | tar -zxC /data_models/im2txt/
RUN curl -SL https://download.pytorch.org/models/resnet152-b121ed2d.pth -o /root/.cache/torch/hub/checkpoints/resnet152-b121ed2d.pth

# actual project
WORKDIR /code
RUN git clone https://github.com/LibrePhotos/librephotos.git .
RUN pip install -r requirements.txt
RUN python -m spacy download en_core_web_sm
EXPOSE 80

# TODO: prod vs dev requirements using docker-compose args
# TODO: in dev copiare anche i vscode settings