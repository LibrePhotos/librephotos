FROM node:24-slim as builder

RUN npm config set fetch-retry-maxtimeout 60000

WORKDIR /usr/src/app
ENV CLI_WIDTH 80

# Copy manifests first for better layer caching
COPY apps/frontend/package.json apps/frontend/yarn.lock ./
COPY apps/frontend/patches/ ./patches/
RUN yarn install --network-timeout 1000000

# Copy the rest of the source
COPY apps/frontend/ ./

ARG GIT_HASH=unknown
RUN yarn run build && echo "${GIT_HASH}" > dist/git_hash.txt

FROM halverneus/static-file-server
ENV PORT 3000
EXPOSE 3000

COPY --from=builder /usr/src/app/dist /web
COPY --from=builder /usr/src/app/dist/git_hash.txt /web

ENTRYPOINT ["/serve"]
CMD []
