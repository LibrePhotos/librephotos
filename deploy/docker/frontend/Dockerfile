FROM node:22-slim as builder

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

FROM halverneus/static-file-server:v1.8.12
ENV PORT 3000
EXPOSE 3000

COPY --from=builder /usr/src/app/apps/frontend/dist /web
COPY --from=builder /usr/src/app/apps/frontend/dist/git_hash.txt /web

ENTRYPOINT ["/serve"]
CMD []
