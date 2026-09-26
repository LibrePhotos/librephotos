# Release builds pass their release tag, so the image sits on the base that was
# promoted for that release instead of whatever :dev points at while it builds.
ARG BASE_TAG=dev
FROM reallibrephotos/librephotos-base:${BASE_TAG}
# actual project

ARG DEBUG
ARG MLVALIDATION
ARG IMAGE_TAG
ENV IMAGE_TAG ${IMAGE_TAG}

WORKDIR /code
# Build context is the monorepo root; source lives under apps/backend/.
# Requirements go in first, so a source-only change reuses the install layers.
COPY apps/backend/requirements*.txt /code/
RUN pip install --break-system-packages --no-cache-dir -r requirements.txt
RUN if [ "$DEBUG" = 1 ] ; then \
  pip install --break-system-packages -r requirements.dev.txt; \
  fi
RUN if [ "$MLVALIDATION" = 1 ] ; then \
  apt-get update && apt-get install default-jre -y; \
  pip install --break-system-packages -r requirements.mlval.txt; \
  fi
COPY apps/backend/ /code/
EXPOSE 8001

COPY deploy/docker/backend/entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"]
