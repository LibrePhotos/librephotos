# Multi-stage build: First build the frontend
FROM node:20-slim as frontend-builder

RUN npm config set fetch-retry-maxtimeout 60000

WORKDIR /frontend
ENV CLI_WIDTH 80

COPY apps/frontend/package.json apps/frontend/yarn.lock ./
COPY apps/frontend/patches/ ./patches/
RUN yarn install --network-timeout 1000000

COPY apps/frontend/ ./
RUN yarn run build

# Second stage: Build the backend with frontend included
FROM reallibrephotos/librephotos-base:dev

ARG DEBUG
ARG MLVALIDATION
ARG IMAGE_TAG
ENV IMAGE_TAG ${IMAGE_TAG}

WORKDIR /code

# Install backend
COPY apps/backend/ /code/
RUN pip install --break-system-packages --no-cache-dir -r requirements.txt

# Install additional packages for frontend serving
RUN pip install --break-system-packages whitenoise

RUN if [ "$DEBUG" = 1 ] ; then \
  pip install --break-system-packages -r requirements.dev.txt; \
  fi
RUN if [ "$MLVALIDATION" = 1 ] ; then \
  apt-get update && apt-get install default-jre -y; \
  pip install --break-system-packages -r requirements.mlval.txt; \
  fi

# Copy frontend build to Django static directory
COPY --from=frontend-builder /frontend/dist /code/frontend_build/
RUN mkdir -p /code/static

# Copy no-proxy configuration files
COPY deploy/docker/unified/production_noproxy.py /code/
COPY deploy/docker/unified/entrypoint.sh /entrypoint.sh

EXPOSE 8001

RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]
