FROM node

RUN apt-get update && apt-get install -y curl git xsel

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
RUN npm install -g npm
RUN npm install -g serve
ENV CLI_WIDTH 80
RUN git clone https://github.com/LibrePhotos/librephotos-frontend.git /usr/src/app
RUN npm ci

EXPOSE 3000

RUN ["chmod", "+x", "./run.sh" ]
