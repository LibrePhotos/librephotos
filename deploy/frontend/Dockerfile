FROM node:13

RUN apt-get update && apt-get install -y curl git xsel

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
RUN npm install -g serve
ENV CLI_WIDTH 80
COPY . /usr/src/app
RUN npm install
RUN npm run build

EXPOSE 3000
COPY entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"]
