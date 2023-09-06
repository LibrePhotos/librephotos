FROM reallibrephotos/librephotos-base-gpu:dev

# Debug flag is more like a dev flag
ARG DEBUG
ARG IMAGE_TAG
ENV IMAGE_TAG ${IMAGE_TAG}

WORKDIR /code
RUN git clone --depth 1 https://github.com/LibrePhotos/librephotos .
RUN pip install --no-cache-dir -r requirements.txt
RUN if [ "$DEBUG" = 1 ] ; then \
  pip install -r requirements.dev.txt; \
  fi
EXPOSE 8001

COPY entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"]
