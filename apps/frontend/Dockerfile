FROM node

RUN apt-get update && \
    apt-get install -y curl git xsel 

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
RUN npm install -g npm
ENV CLI_WIDTH 80
COPY package.json /usr/src/app
RUN npm install 
RUN npm install -g serve
EXPOSE 3000

COPY . /usr/src/app
RUN npm run build

CMD [ "./run.sh" ]

ENTRYPOINT ./run.sh
