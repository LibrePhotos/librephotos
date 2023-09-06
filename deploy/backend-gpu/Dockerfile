FROM reallibrephotos/librephotos-base-gpu:dev
# actual project
ARG DEBUG
ARG IMAGE_TAG
ENV IMAGE_TAG ${IMAGE_TAG}

WORKDIR /code
RUN git clone --depth 1 https://github.com/LibrePhotos/librephotos .
RUN pip install --break-system-packages --no-cache-dir -r requirements.txt
RUN if [ "$DEBUG" = 1 ] ; then \
  pip install --break-system-packages -r requirements.dev.txt; \
  fi
EXPOSE 8001

COPY entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"]
