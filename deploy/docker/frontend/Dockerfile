# This build stage is the same in deploy/docker/unified/Dockerfile; keep the two
# identical (apps/backend/api/tests/infra/test_deploy_images.py).
FROM node:24-slim as builder

RUN npm config set fetch-retry-maxtimeout 60000

# Mirror the repo layout: the frontend compiles the shared API client from
# ../../packages/api-client (vite.config.ts / tsconfig.json aliases).
WORKDIR /usr/src/app/apps/frontend
ENV CLI_WIDTH 80

# Copy manifests first for better layer caching
COPY apps/frontend/package.json apps/frontend/yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 1000000

# Copy the rest of the source
COPY packages/api-client/ /usr/src/app/packages/api-client/
COPY apps/frontend/ ./

ARG GIT_HASH=unknown
RUN yarn run build && echo "${GIT_HASH}" > dist/git_hash.txt

FROM golang:1.27-alpine AS static-file-server
ARG STATIC_FILE_SERVER_VERSION=v1.8.12
RUN CGO_ENABLED=0 GOBIN=/out go install -trimpath -tags netgo \
      -ldflags "-s -w -X github.com/halverneus/static-file-server/cli/version.version=${STATIC_FILE_SERVER_VERSION#v}" \
      "github.com/halverneus/static-file-server/bin/serve@${STATIC_FILE_SERVER_VERSION}" \
 && printf '%s\n' \
      'root:x:0:0:root:/root:/sbin/nologin' \
      'nobody:x:65534:65534:nobody:/nonexistent:/sbin/nologin' \
      'static:x:1000:65534::/nonexistent:/sbin/nologin' > /out/passwd

FROM scratch
COPY --from=static-file-server /out/serve /serve
COPY --from=static-file-server /out/passwd /etc/passwd
USER static
ENV PORT=3000
EXPOSE 3000

COPY --from=builder /usr/src/app/apps/frontend/dist /web

ENTRYPOINT ["/serve"]
CMD []
